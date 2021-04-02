#include "Deck.h"
#include "utils.h"
#include <inttypes.h>

namespace {
    static const auto kSilenceThreshold = Decibels::decibelsToGain(-60.0f);
    static const auto kEndingSilenceThreshold = Decibels::decibelsToGain(-45.0f);
    static const auto kFadingSilenceThreshold = Decibels::decibelsToGain(-23.0f);

    constexpr float kFirstSoundDuration = 0.001f;
    constexpr float kLastSoundDuration = 1.25f;
    constexpr auto kLeadingScanningDuration = 10.0;
    constexpr float kLastSoundScanningDurartion = 20.0f;
}

namespace medley {

Deck::Deck(const String& name, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread)
    :
    formatMgr(formatMgr),
    loadingThread(loadingThread),
    readAheadThread(readAheadThread),
    name(name),
    loader(*this),
    scanningScheduler(*this),
    playhead(*this)
{
    loadingThread.addTimeSliceClient(&loader);
    loadingThread.addTimeSliceClient(&scanningScheduler);
    readAheadThread.addTimeSliceClient(&playhead);
}

Deck::~Deck() {
    releaseChainedResources();
    unloadTrackInternal();
}

String Deck::tagName() const
{
    return "[" + name + "]";
}

void Deck::log(const String& s) {
    Logger::writeToLog(tagName() + " " + s);
}

double Deck::getDuration() const
{
    if (sampleRate > 0.0)
        return (double)getTotalLength() / sampleRate;

    return 0.0;
}

double Deck::getPositionInSeconds() const
{
    if (sampleRate > 0.0)
        return (double)getNextReadPosition() / sampleRate;

    return 0.0;
}

void Deck::loadTrack(const ITrack::Ptr track, OnLoadingDone doneCallback)
{
    if (isTrackLoading) {
        doneCallback(false);
        return;
    }

    if (!utils::isTrackLoadable(formatMgr, track)) {
        log("Could not find appropriate format reader for " + track->getFile().getFullPathName());
        doneCallback(false);
        return;
    }

    pregain = track->getPreGain();

    // negative or zero pregain just doesn't make any sense!
    if (pregain <= 0.0f) {
        pregain = 1.0f;
    }

    isTrackLoading = true;
    loader.load(track, doneCallback);
}

void Deck::unloadTrack()
{
    setSource(nullptr);
    unloadTrackInternal();
}

bool Deck::loadTrackInternal(const ITrack::Ptr track)
{
    log("Loading: " + track->getFile().getFullPathName());
    auto newReader = utils::createAudioReaderFor(formatMgr, track);

    if (!newReader) {
        log("Could not create format reader");
        return false;
    }

    unloadTrackInternal();
    reader = newReader;

    auto mid = reader->lengthInSamples / 2;
    firstAudibleSamplePosition = jmax(0LL, reader->searchForLevel(0, mid, kSilenceThreshold, 1.0, (int)(reader->sampleRate * kFirstSoundDuration)));
    totalSamplesToPlay = reader->lengthInSamples;
    lastAudibleSamplePosition = totalSamplesToPlay;
    leadingSamplePosition = -1;
    trailingPosition = -1;
    trailingDuration = 0;

    auto playDuration = getEndPosition();

    if (playDuration >= 3) {
        Range<float> maxLevels[2]{};
        reader->readMaxLevels(firstAudibleSamplePosition, (int)(reader->sampleRate * jmax(maxTransitionTime, kLeadingScanningDuration)), maxLevels, 2);

        auto leadingDecibel = Decibels::gainToDecibels((maxLevels[0].getEnd() + maxLevels[1].getEnd()) / 2.0f);
        auto leadingLevel = jlimit(0.0f, 0.9f, Decibels::decibelsToGain(leadingDecibel - 6.0f));

        leadingSamplePosition = reader->searchForLevel(
            firstAudibleSamplePosition,
            (int)(reader->sampleRate * kLeadingScanningDuration),
            leadingLevel, 1.0,
            (int)(reader->sampleRate * kFirstSoundDuration / 10)
        );


        if (leadingSamplePosition > -1) {
            auto lead2 = reader->searchForLevel(
                jmax(0LL, leadingSamplePosition - (int)(reader->sampleRate * 2.0)),
                (int)(reader->sampleRate * 2.0),
                leadingLevel * 0.33, 1.0,
                0
            );

            if ((lead2 > firstAudibleSamplePosition) && (lead2 < leadingSamplePosition)) {
                leadingSamplePosition = lead2;
            }
        }
    }

    leadingDuration = (leadingSamplePosition > -1) ? (leadingSamplePosition - firstAudibleSamplePosition) / reader->sampleRate : 0;

    setSource(new AudioFormatReaderSource(reader, false));

    if (playDuration >= 3) {
        scanningScheduler.scan(track);
    }
    else {
        calculateTransition();
    }

    log(String::formatted("Loaded - leading@%.2f duration=%.2f", leadingSamplePosition / reader->sampleRate, leadingDuration));

    this->track = track;
    isTrackLoading = false;

    listeners.call([this](Callback& cb) {
        cb.deckLoaded(*this);
    });

    return true;
}


void Deck::unloadTrackInternal()
{
    isTrackLoading = false;
    inputStreamEOF = false;
    playing = false;
    stopped = true;
    fading = false;

    bool deckUnloaded = false;
    {
        const ScopedLock sl(sourceLock);

        if (resamplerSource) {
            delete resamplerSource;
            resamplerSource = nullptr;
            deckUnloaded = true;
        }

        if (bufferingSource) {
            delete bufferingSource;
            bufferingSource = nullptr;
            deckUnloaded = true;
        }

        if (source) {
            delete source;
            source = nullptr;
            deckUnloaded = true;
        }

        if (reader) {
            delete reader;
            reader = nullptr;
            deckUnloaded = true;
        }
    }

    if (deckUnloaded) {
        listeners.call([this](Callback& cb) {
            cb.deckUnloaded(*this);
        });
    }

    track = nullptr;
    pregain = 1.0f;
    volume = 1.0f;
    updateGain();
}

void Deck::scanTrackInternal(const ITrack::Ptr trackToScan)
{
    auto scanningReader = utils::createAudioReaderFor(formatMgr, trackToScan);

    if (!scanningReader) {
        return;
    }

    log("Scanning");

    listeners.call([this](Callback& cb) {
        cb.deckTrackScanning(*this);
    });

    auto middlePosition = scanningReader->lengthInSamples / 2;
    auto tailPosition = jmax(
        firstAudibleSamplePosition,
        middlePosition,
        (int64)(scanningReader->lengthInSamples - scanningReader->sampleRate * kLastSoundScanningDurartion)
    );

    auto silencePosition = scanningReader->searchForLevel(
        tailPosition,
        scanningReader->lengthInSamples - tailPosition,
        0, kSilenceThreshold,
        (int)(scanningReader->sampleRate * kLastSoundDuration)
    );

    if (silencePosition < 0) {
        silencePosition = 0;
    }

    if (silencePosition > firstAudibleSamplePosition) {
        lastAudibleSamplePosition = silencePosition;
    }

    auto endPosition = scanningReader->searchForLevel(
        silencePosition,
        scanningReader->lengthInSamples - silencePosition,
        0, kSilenceThreshold,
        (int)(scanningReader->sampleRate * 0.004)
    );

    if (endPosition > lastAudibleSamplePosition) {
        totalSamplesToPlay = endPosition;
    }

    trailingPosition = scanningReader->searchForLevel(
        tailPosition,
        totalSamplesToPlay - tailPosition,
        0, kFadingSilenceThreshold,
        (int)(scanningReader->sampleRate * 0.8)
    );

    trailingDuration = (trailingPosition > -1) ? (lastAudibleSamplePosition - trailingPosition) / scanningReader->sampleRate : 0;

    calculateTransition();

    if (trailingDuration > 0) {
        log(String::formatted(
            "Scanned - trailing@%.2f/%.2f duration=%.2f",
            trailingPosition / scanningReader->sampleRate,
            totalSamplesToPlay / scanningReader->sampleRate,
            trailingDuration
        ));
    } else {
        log("Scanned - no trailing found");
    }

    listeners.call([this](Callback& cb) {
        cb.deckTrackScanned(*this);
    });

    delete scanningReader;
}

void Deck::calculateTransition()
{
    transitionStartPosition = lastAudibleSamplePosition / sourceSampleRate;
    transitionEndPosition = transitionStartPosition;

    if (trailingDuration > 0.0 && maxTransitionTime > 0.0)
    {

        if (trailingDuration >= maxTransitionTime) {
            transitionStartPosition = trailingPosition / sourceSampleRate;
            transitionEndPosition = transitionStartPosition + maxTransitionTime;
        }
        else {
            transitionStartPosition = jmax(2.0, transitionEndPosition - trailingDuration);
        }
    }

    transitionCuePosition = jmax(0.0, transitionStartPosition - jmax(kLeadingScanningDuration, maxTransitionTime));
    if (transitionCuePosition == 0.0) {
        transitionCuePosition = jmax(0.0, transitionStartPosition - jmax(kLeadingScanningDuration, maxTransitionTime) / 2.0);
    }

    transitionPreCuePosition = jmax(0.0, transitionCuePosition - 1.0);

    if (transitionPreCuePosition == transitionCuePosition) {
        transitionCuePosition = jmin(transitionPreCuePosition + 1, transitionEndPosition);
    }
}

void Deck::firePositionChangeCalback(double position)
{
    listeners.call([=](Callback& cb) {
        cb.deckPosition(*this, position);
    });
}

void Deck::setPosition(double newPosition)
{
    if (sampleRate > 0.0)
        setNextReadPosition((int64)(newPosition * sampleRate));
}

void Deck::setPositionFractional(double fraction) {
    setPosition(getDuration() * fraction);
}

void Deck::getNextAudioBlock(const AudioSourceChannelInfo& info)
{
    const ScopedLock sl(sourceLock);

    bool wasPlaying = !stopped;

    if (resamplerSource != nullptr && !stopped)
    {
        resamplerSource->getNextAudioBlock(info);

        if (!playing)
        {
            // just stopped playing, so fade out the last block..
            for (int i = info.buffer->getNumChannels(); --i >= 0;) {
                info.buffer->applyGainRamp(i, info.startSample, jmin(256, info.numSamples), 1.0f, 0.0f);
            }

            if (info.numSamples > 256) {
                info.buffer->clear(info.startSample + 256, info.numSamples - 256);
            }
        }

        if (bufferingSource->getNextReadPosition() > totalSamplesToPlay + 1 && !bufferingSource->isLooping())
        {
            playing = false;
            inputStreamEOF = true;
        }

        stopped = !playing;

        for (int i = info.buffer->getNumChannels(); --i >= 0;) {
            info.buffer->applyGainRamp(i, info.startSample, info.numSamples, lastGain, gain);
        }
    }
    else
    {
        info.clearActiveBufferRegion();
        stopped = true;
        fading = false;
    }

    lastGain = gain;

    if (wasPlaying && stopped) {
        fireFinishedCallback();
    }
}

void Deck::setNextReadPosition(int64 newPosition)
{
    if (bufferingSource != nullptr)
    {
        if (sampleRate > 0 && sourceSampleRate > 0)
            newPosition = (int64)((double)newPosition * sourceSampleRate / sampleRate);

        bufferingSource->setNextReadPosition(newPosition);

        if (resamplerSource != nullptr)
            resamplerSource->flushBuffers();

        inputStreamEOF = false;
    }
}

int64 Deck::getNextReadPosition() const
{
    if (bufferingSource != nullptr)
    {
        const double ratio = (sampleRate > 0 && sourceSampleRate > 0) ? sampleRate / sourceSampleRate : 1.0;
        return (int64)((double)bufferingSource->getNextReadPosition() * ratio);
    }

    return 0;
}

int64 Deck::getTotalLength() const
{
    const ScopedLock sl(sourceLock);

    if (bufferingSource != nullptr)
    {
        const double ratio = (sampleRate > 0 && sourceSampleRate > 0) ? sampleRate / sourceSampleRate : 1.0;
        return (int64)((double)bufferingSource->getTotalLength() * ratio);
    }
    return 0;
}

bool Deck::isLooping() const
{
    const ScopedLock sl(sourceLock);
    return bufferingSource != nullptr && bufferingSource->isLooping();
}

bool Deck::start()
{
    log("Try to start playing");
    if ((!playing) && resamplerSource != nullptr)
    {
        playing = true;
        stopped = false;
        fading = false;
        inputStreamEOF = false;

        listeners.call([this](Callback& cb) {
            cb.deckStarted(*this);
        });
        return true;
    }

    // Something went wrong
    log("Could not start playing");
    main = false;
    return false;
}

void Deck::stop()
{
    if (playing)
    {
        playing = false;
    }

    fading = false;
}

void Deck::fireFinishedCallback()
{
    log("Finished");

    listeners.call([this](Callback& cb) {
        cb.deckFinished(*this);
    });

    unloadTrackInternal();
}

void Deck::updateGain()
{
    gain = pregain * volume;
}

void Deck::setMaxTransitionTime(double duration)
{
    maxTransitionTime = duration;
    calculateTransition();
}

double Deck::getFirstAudiblePosition() const {
    return (double)firstAudibleSamplePosition / sourceSampleRate;
}

double Deck::getEndPosition() const
{
    return totalSamplesToPlay / sourceSampleRate;
}

void Deck::fadeOut(bool force)
{
    if (!fading || force) {
        transitionCuePosition = transitionStartPosition = getPositionInSeconds();
        transitionEndPosition = jmin(transitionStartPosition + maxTransitionTime, totalSamplesToPlay * sourceSampleRate);
        fading = true;
    }
}


void Deck::addListener(Callback* cb) {
    listeners.add(cb);
}

void Deck::removeListener(Callback* cb)
{
    listeners.remove(cb);
}

void Deck::prepareToPlay(int samplesPerBlockExpected, double newSampleRate)
{
    const ScopedLock sl(sourceLock);

    sampleRate = newSampleRate;
    blockSize = samplesPerBlockExpected;

    if (resamplerSource != nullptr) {
        resamplerSource->prepareToPlay(samplesPerBlockExpected, sampleRate);
    }

    if (resamplerSource != nullptr && sourceSampleRate > 0) {
        resamplerSource->setResamplingRatio(sourceSampleRate / sampleRate);
    }

    inputStreamEOF = false;
    isPrepared = true;
}

void Deck::releaseResources()
{
    releaseChainedResources();
}

void Deck::setSource(AudioFormatReaderSource* newSource)
{
    const ScopedLock sl(sourceLock);

    if (source == newSource) {
        if (newSource == nullptr) {
            return;
        }

        setSource(nullptr);
    }

    BufferingAudioSource* newBufferingSource = nullptr;
    ResamplingAudioSource* newResamplerSource = nullptr;

    std::unique_ptr<BufferingAudioSource> oldBufferingSource(bufferingSource);
    std::unique_ptr<ResamplingAudioSource> oldResamplerSource(resamplerSource);

    if (newSource != nullptr) {
        sourceSampleRate = newSource->getAudioFormatReader()->sampleRate;

        newBufferingSource = new BufferingAudioSource(newSource, readAheadThread, false, (int)(sourceSampleRate * 2), 2);
        newBufferingSource->setNextReadPosition(firstAudibleSamplePosition);

        newResamplerSource = new ResamplingAudioSource(newBufferingSource, false, 2);

        if (isPrepared)
        {
            newResamplerSource->setResamplingRatio(sourceSampleRate / sampleRate);
            newResamplerSource->prepareToPlay(blockSize, sampleRate);
        }
    }

    source = newSource;
    bufferingSource = newBufferingSource;
    resamplerSource = newResamplerSource;

    inputStreamEOF = false;
    playing = false;

    if (oldResamplerSource != nullptr) {
        oldResamplerSource->releaseResources();
    }

    if (newSource != nullptr) {
        calculateTransition();
    }
}

void Deck::releaseChainedResources()
{
    const ScopedLock sl(sourceLock);

    if (resamplerSource != nullptr) {
        resamplerSource->releaseResources();
    }

    isPrepared = false;
}

Deck::Loader::~Loader()
{
    track = nullptr;
}

int Deck::Loader::useTimeSlice()
{
    ScopedLock sl(lock);

    if (track != nullptr) {
        auto ret = deck.loadTrackInternal(track);
        track = nullptr;
        callback(ret);
    }

    return 100;
}

void Deck::Loader::load(const ITrack::Ptr track, OnLoadingDone callback)
{
    ScopedLock sl(lock);
    this->track = track;
    this->callback = callback;
}

int Deck::Scanner::useTimeSlice()
{
    if (track) {
        deck.scanTrackInternal(track);
        track = nullptr;
    }

    return 100;
}

void Deck::Scanner::scan(const ITrack::Ptr track)
{
    this->track = track;
}

int Deck::PlayHead::useTimeSlice()
{
    auto pos = deck.getPositionInSeconds();
    if (lastPosition != pos) {
        deck.firePositionChangeCalback(pos);
        lastPosition = pos;
    }

    return deck.isPlaying() ? 33 : 250;
}

}