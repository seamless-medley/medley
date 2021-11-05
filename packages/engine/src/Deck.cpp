#include "Deck.h"
#include "utils.h"
#include <inttypes.h>

namespace {
    static const auto kSilenceThreshold = Decibels::decibelsToGain(-60.0f);
    static const auto kEndingSilenceThreshold = Decibels::decibelsToGain(-45.0f);
    static const auto kFadingSilenceThreshold = Decibels::decibelsToGain(-30.0f);
    static const auto kRisingFadeSilenceThreshold = Decibels::decibelsToGain(-27.0f);

    constexpr float kFirstSoundDuration = 0.001f;
    constexpr float kLastSoundDuration = 1.25f;
    constexpr auto kLeadingScanningDuration = 25.0;
    constexpr float kLastSoundScanningDurartion = 20.0f;
}

namespace medley {

using namespace medley::utils;

Deck::Deck(uint8_t index, const String& name, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread)
    :
    index(index),
    formatMgr(formatMgr),
    loadingThread(loadingThread),
    readAheadThread(readAheadThread),
    name(name),
    loader(*this),
    scanner(*this),
    playhead(*this)
{
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

double Deck::getPosition() const
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

    if (!isTrackLoadable(formatMgr, track)) {
        log("Could not find appropriate format reader for " + track->getFile().getFullPathName());
        isTrackLoading = false;
        doneCallback(false);
        return;
    }

    isTrackLoading = true;
    loader.load(track, doneCallback);
    loadingThread.addTimeSliceClient(&loader);
    if (!loadingThread.isThreadRunning()) {
        loadingThread.startThread();
    }
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
        isTrackLoading = false;
        return false;
    }

    if (track != nullptr) {
        unloadTrackInternal();
        reader = newReader;
    }

    auto mid = reader->lengthInSamples / 2;
    firstAudibleSamplePosition = jmax(0LL, reader->searchForLevel(0, mid, kSilenceThreshold, 1.0, (int)(reader->sampleRate * kFirstSoundDuration)));
    totalSourceSamplesToPlay = reader->lengthInSamples;
    lastAudibleSamplePosition = totalSourceSamplesToPlay;
    leadingSamplePosition = -1;
    trailingSamplePosition = -1;
    trailingDuration = 0;

    auto playDuration = getEndPosition();

    {   // Seamless mode
        if (playDuration >= 3.0) {
            Range<float> maxLevels[2]{};
            reader->readMaxLevels(
                firstAudibleSamplePosition,
                (int)(reader->sampleRate * jmax(kLeadingScanningDuration, maximumFadeOutDuration)),
                maxLevels,
                jmin((int)reader->numChannels, 2)
            );

            auto detectedLevel = (abs(maxLevels[0].getEnd()) + abs(maxLevels[1].getEnd())) / 2.0f;
            auto leadingDecibel = Decibels::gainToDecibels(detectedLevel);
            auto leadingLevel = jlimit(0.0f, 0.9f, Decibels::decibelsToGain(leadingDecibel - 6.0f));

            leadingSamplePosition = reader->searchForLevel(
                firstAudibleSamplePosition,
                (int)(reader->sampleRate * kLeadingScanningDuration),
                leadingLevel, 1.0,
                (int)(reader->sampleRate * kFirstSoundDuration / 10)
            );


            if (leadingSamplePosition > -1) {
                auto lead2 = reader->searchForLevel(
                    jmax(0LL, leadingSamplePosition - (int)(reader->sampleRate * 3.0)),
                    (int)(reader->sampleRate * 4.0),
                    leadingLevel * 0.66, 1.0,
                    (int)(reader->sampleRate * kFirstSoundDuration / 10)
                );

                leadingSamplePosition = lead2;
            }
        }
    }

    leadingDuration = ((leadingSamplePosition > -1) ? leadingSamplePosition - firstAudibleSamplePosition : firstAudibleSamplePosition) / reader->sampleRate;

    setSource(new AudioFormatReaderSource(reader, false));

    if (playDuration >= 3) {
        scanner.scan(track);
        loadingThread.addTimeSliceClient(&scanner);
    }
    else {
        calculateTransition();
    }

    log(String::formatted("Loaded - leading@%.2f duration=%.2f", leadingSamplePosition / reader->sampleRate, leadingDuration));

    m_metadata.readFromTrack(track);

    setReplayGain(m_metadata.getTrackGain());

    log(String::formatted("Gain correction: %.2fdB", Decibels::gainToDecibels(gainCorrection)));

    this->track = track;
    isTrackLoading = false;

    listeners.call([this](Callback& cb) {
        cb.deckLoaded(*this, this->track);
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
            cb.deckUnloaded(*this, this->track);
        });
    }

    nextReadPosition = 0;
    track = nullptr;
    setReplayGain(0.0f);
    setVolume(1.0f);
}

int64 Deck::findBoring(AudioFormatReader* reader, int64 startSample, int64 endSample) {
    auto currentSample = startSample;
    auto duration = (endSample - startSample) / (float)reader->sampleRate;

    auto blockSize = (int)(reader->sampleRate * 0.3);

    int64 startBoringSample = -1;
    double boringScore = 0.0;

    auto hardLimit = Decibels::decibelsToGain(-22.0f);
    auto threshold = hardLimit;

    while (currentSample < endSample) {
        AudioBuffer<float> tempSampleBuffer(reader->numChannels, blockSize);
        reader->read(&tempSampleBuffer, 0, blockSize, currentSample, true, true);

        float rms[2]{};
        for (auto i = 0; i < jmin(2, (int)reader->numChannels); i++) {
            rms[i] = tempSampleBuffer.getRMSLevel(i, 0, blockSize);
        }

        auto level = (float)(2.8 * ((double)rms[0] + (double)rms[1]) / 2.0);

        if (level < threshold) {
            if (startBoringSample == -1) {
                startBoringSample = currentSample;
            }

            boringScore += 1.0;
            threshold = level;
        }
        else if (level >= jmin(hardLimit, Decibels::decibelsToGain(Decibels::gainToDecibels(threshold) + 3.0f))) {
            boringScore = boringScore * 0.6;
            if (boringScore <= 0.15) {
                boringScore = 0;
                startBoringSample = -1;
                threshold = hardLimit;
            }
        }

        if (startBoringSample > -1 && boringScore >= 1.0) {
            auto boringDuration = (currentSample - startBoringSample) / (double)reader->sampleRate;
            if (boringDuration >= 1.0) {
                return startBoringSample;
            }
        }

        currentSample += blockSize;
    }

    return -1;
}

int64 Deck::findFadingPosition(AudioFormatReader* reader, int64 startSample, int64 numSamples) {
    auto startPosition = startSample;
    auto endPosition = startSample + numSamples;
    int64 result = -1;
    int64 lastFadingPosition = startPosition;

    auto consecutiveSamples = (int)(reader->sampleRate * 0.3);

    while (startSample < endPosition) {
        auto position = reader->searchForLevel(
            startSample,
            endPosition - startSample,
            0, kFadingSilenceThreshold,
            consecutiveSamples
        );

        if (position < 0) {
            break;
        }

        if (result > lastFadingPosition) {
            lastFadingPosition = result;
        }

        result = position;

        auto risingPosition = reader->searchForLevel(
            position,
            endPosition - position,
            kRisingFadeSilenceThreshold, 1.0,
            (int)(reader->sampleRate * 0.005)
        );

        if (risingPosition < 0) {
            break;
        }

        startSample = risingPosition + 1;
    }

    if (result > startPosition) {
        log(String::formatted("Fading out at %.2f", result / reader->sampleRate));
    }

    auto boring = findBoring(reader, lastFadingPosition, endPosition);
    if (boring > lastFadingPosition && boring < result) {
        result = boring;
        log(String::formatted("Boring at %.2f", boring / reader->sampleRate));
    }

    return result;
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

    auto guessedSilencePosition = scanningReader->searchForLevel(
        tailPosition,
        scanningReader->lengthInSamples - tailPosition,
        0, kSilenceThreshold,
        (int)(scanningReader->sampleRate * kLastSoundDuration)
    );

    if (guessedSilencePosition < 0) {
        guessedSilencePosition = (int64)((double)scanningReader->lengthInSamples - scanningReader->sampleRate * kLastSoundDuration);
    }
    else if (guessedSilencePosition > firstAudibleSamplePosition) {
        lastAudibleSamplePosition = guessedSilencePosition;
    }

    auto endPosition = scanningReader->searchForLevel(
        guessedSilencePosition,
        scanningReader->lengthInSamples - guessedSilencePosition,
        0, kSilenceThreshold,
        (int)(scanningReader->sampleRate * 0.004)
    );

    if (endPosition > lastAudibleSamplePosition) {
        totalSourceSamplesToPlay = endPosition;
    }

    trailingSamplePosition = findFadingPosition(scanningReader, tailPosition, lastAudibleSamplePosition - tailPosition);
    trailingDuration = (trailingSamplePosition > -1) ? (lastAudibleSamplePosition - trailingSamplePosition) / scanningReader->sampleRate : 0;

    calculateTransition();

    if (trailingDuration > 0) {
        log(String::formatted(
            "Scanned - trailing@%.2f/%.2f duration=%.2f",
            trailingSamplePosition / scanningReader->sampleRate,
            totalSourceSamplesToPlay / scanningReader->sampleRate,
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

    if (trailingDuration > 0.0 && maximumFadeOutDuration > 0.0)
    {

        if (trailingDuration >= maximumFadeOutDuration) {
            transitionStartPosition = trailingSamplePosition / sourceSampleRate;
            transitionEndPosition = transitionStartPosition + maximumFadeOutDuration;
            trailingDuration = maximumFadeOutDuration;
        }
        else {
            transitionStartPosition = jmax(2.0, transitionEndPosition - trailingDuration);
        }
    }

    transitionCuePosition = jmax(0.0, transitionStartPosition - jmax(kLeadingScanningDuration, maximumFadeOutDuration));
    if (transitionCuePosition == 0.0) {
        transitionCuePosition = jmax(0.0, transitionStartPosition - jmax(kLeadingScanningDuration, maximumFadeOutDuration) / 2.0);
    }

    transitionPreCuePosition = jmax(0.0, transitionCuePosition - 1.0);

    if (transitionPreCuePosition == transitionCuePosition) {
        transitionCuePosition = jmin(transitionPreCuePosition + 1, transitionEndPosition);
    }
}

void Deck::doPositionChange(double position)
{
    listeners.call([=](Callback& cb) {
        cb.deckPosition(*this, position);
    });
}

void Deck::setPosition(double time)
{
    if (sampleRate > 0.0) {
        auto firstAudibleTime = getFirstAudiblePosition();

        if (time < firstAudibleTime) {
            time = firstAudibleTime;
        }

        setNextReadPosition((int64)(time * sampleRate));
        doPositionChange(time);
    }
}

void Deck::setPositionFractional(double fraction) {
    setPosition(getDuration() * fraction);
}

void Deck::getNextAudioBlock(const AudioSourceChannelInfo& info)
{
    const ScopedLock sl(sourceLock);

    if (internallyPaused) {
        info.clearActiveBufferRegion();
        return;
    }

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

        auto samplesToPlay = totalSourceSamplesToPlay;
        nextReadPosition = bufferingSource->getNextReadPosition();

        if (nextReadPosition > samplesToPlay + 1 && !bufferingSource->isLooping())
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
    const ScopedLock sl(sourceLock);

    if (bufferingSource != nullptr)
    {
        if (sampleRate > 0 && sourceSampleRate > 0)
            newPosition = (int64)((double)newPosition * sourceSampleRate / sampleRate);

        nextReadPosition = newPosition;
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
        return (int64)((double)nextReadPosition * ratio);
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
    if ((!playing || internallyPaused) && resamplerSource != nullptr)
    {
        if (!internallyPaused) {
            listeners.call([this](Callback& cb) {
                cb.deckStarted(*this, this->track);
            });
        }

        playing = true;
        internallyPaused = false;
        stopped = false;
        fading = false;
        inputStreamEOF = false;

        return true;
    }

    return playing;
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
    if (track == nullptr) {
        return;
    }

    log("Finished");    

    listeners.call([this](Callback& cb) {
        cb.deckFinished(*this, this->track);
    });

    unloadTrackInternal();
}

void Deck::setReplayGain(float rg)
{
    replayGain = rg;

    if (replayGain <= 0.0f) {
        replayGain = 0.0f;
    }

    gainCorrection = (replayGain > 0.0) ? replayGain * Decibels::decibelsToGain(replayGainBoost) : 1.0f;

    gain = gainCorrection * volume;
}

void Deck::setMaximumFadeOutDuration(double duration)
{
    maximumFadeOutDuration = duration;
    calculateTransition();
}

double Deck::getFirstAudiblePosition() const {
    return (double)firstAudibleSamplePosition / sourceSampleRate;
}

double Deck::getLastAudiblePosition() const
{
    return (double)lastAudibleSamplePosition / sourceSampleRate;
}

double Deck::getEndPosition() const
{
    return totalSourceSamplesToPlay / sourceSampleRate;
}

void Deck::fadeOut(bool force)
{
    if (!fading || force) {
        transitionCuePosition = transitionStartPosition = getPosition();
        transitionEndPosition = jmin(transitionStartPosition + jmin(3.0, maximumFadeOutDuration), getEndPosition());
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

    nextReadPosition = 0;
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

    return -1;
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

    return -1;
}

void Deck::Scanner::scan(const ITrack::Ptr track)
{
    this->track = track;
}

int Deck::PlayHead::useTimeSlice()
{
    auto pos = deck.getPosition();
    if (lastPosition != pos) {
        deck.doPositionChange(pos);
        lastPosition = pos;
    }
    else {
        if (deck.stopped && deck.playing) {
            // This is rare, something went wrong and playback was stalled somehow.
            // try to restart playback
            deck.playing = false;
            deck.start();
        }
    }

    return deck.isPlaying() ? 10 : 250;
}

}