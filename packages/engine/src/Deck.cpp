#include "Deck.h"
#include "utils.h"
#include <cinttypes>
#include <cstddef>

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

Deck::Deck(uint8_t index, const String& name, ILoggerWriter* logWriter, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread)
    :
    formatMgr(formatMgr),
    loadingThread(loadingThread),
    readAheadThread(readAheadThread),
    index(index),
    name(name),
    loader(*this),
    scanner(*this),
    playhead(*this)
{
    logger = std::make_unique<medley::Logger>(name, logWriter);

    readAheadThread.setPriority(8);
    readAheadThread.addTimeSliceClient(&playhead);
}

Deck::~Deck() {
    releaseChainedResources();
    unloadTrackInternal();
}

void Deck::log(medley::LogLevel level, const String& s) {
    logger->log(level, s.toStdString());
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
    if (_isTrackLoading) {
        doneCallback(false);
        return;
    }

    _isTrackLoading = true;
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
    logger->debug("Loading: " + track->getFile().getFullPathName());
    auto newReader = utils::createAudioReaderFor(formatMgr, track);

    if (!newReader) {
        logger->warn("Could not create format reader");
        _isTrackLoading = false;
        return false;
    }

    if (track != nullptr) {
        unloadTrackInternal();
    }

    auto reader = newReader;

    try {
        m_metadata.readFromTrack(track);
    }
    catch (std::exception& e) {
        logger->error(("Error reading metadata: " + track->getFile().getFullPathName() + " " + e.what()).toStdString());
    }

    auto mid = reader->lengthInSamples / 2;
    firstAudibleSamplePosition = jmax(0LL, reader->searchForLevel(0, mid, kSilenceThreshold, 1.0, (int)(reader->sampleRate * kFirstSoundDuration)));
    totalSourceSamplesToPlay = reader->lengthInSamples;
    lastAudibleSamplePosition = -1;

    auto embededLastAudible = m_metadata.getLastAudible();
    if (embededLastAudible > 0) {
        lastAudibleSamplePosition = (int64)(m_metadata.getLastAudible() * reader->sampleRate);
    }

    if (lastAudibleSamplePosition > 0 && lastAudibleSamplePosition < totalSourceSamplesToPlay) {
        totalSourceSamplesToPlay = lastAudibleSamplePosition;
    }
    else {
        lastAudibleSamplePosition = totalSourceSamplesToPlay;
    }

    auto providedCueIn = track->getCueInPosition();

    if (providedCueIn < 0) {
        providedCueIn = m_metadata.getCueIn();
    }

    if (providedCueIn >= 0) {
        // Calculate cue-in position if it was hinted from the track itself
        auto cueInSamplePosition = (int64)(providedCueIn * reader->sampleRate);

        if (cueInSamplePosition > firstAudibleSamplePosition && cueInSamplePosition <= mid) {
            firstAudibleSamplePosition = cueInSamplePosition;
        }
    }

    leadingSamplePosition = -1;
    trailingSamplePosition = -1;
    trailingDuration = 0;
    leadingDuration = 0;

    auto playDuration = (totalSourceSamplesToPlay - firstAudibleSamplePosition) / newReader->sampleRate;

    // If no cue in provided
    if (providedCueIn < 0)
    {
        // and the track is longer than 3 seconds
        if (playDuration >= 3.0) {
            // Try to detect leading fade-in

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

        if (leadingSamplePosition > -1) {
            leadingDuration = (leadingSamplePosition - firstAudibleSamplePosition) / reader->sampleRate;
        }
        else {
            leadingDuration = firstAudibleSamplePosition / reader->sampleRate;
        }

        if (leadingDuration < 0) {
            leadingDuration = 0;
        }
    }

    setSource(new AudioFormatReaderSource(reader, false));

    scanner.scan(track);
    loadingThread.addTimeSliceClient(&scanner);

    logger->debug(String::formatted("Loaded - leading@%.2f duration=%.2f", leadingSamplePosition / reader->sampleRate, leadingDuration));

    setReplayGain(m_metadata.getTrackGain());
    logger->debug(String::formatted("Gain correction: %.2fdB", Decibels::gainToDecibels(gainCorrection)));

    this->reader = reader;

    this->track = track;
    _isTrackLoading = false;

    listeners.call([this](Callback& cb) {
        this->trackPlay = TrackPlay(this->track, getDuration());

        cb.deckLoaded(*this, this->trackPlay);
    });

    return true;
}


void Deck::unloadTrackInternal()
{
    _isTrackLoading = false;
    inputStreamEOF = false;
    started = false;
    stopped = true;
    fadingOut = false;

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
        auto play = this->trackPlay;

        listeners.call([this, &play](Callback& cb) {
            cb.deckUnloaded(*this, play);
        });
    }

    nextReadPosition = 0;
    track = nullptr;
    trackPlay = TrackPlay();
    setReplayGain(0.0f);
    setVolume(1.0f);
}

int64 Deck::findBoring(AudioFormatReader* reader, int64 startSample, int64 endSample) {
    auto currentSample = startSample;
    // auto duration = (endSample - startSample) / (float)reader->sampleRate;

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
        logger->debug(String::formatted("Fading out at %.2f", result / reader->sampleRate));
    }

    auto boring = findBoring(reader, lastFadingPosition, endPosition);
    if (boring > lastFadingPosition && boring < result) {
        result = boring;
        logger->debug(String::formatted("Boring at %.2f", boring / reader->sampleRate));
    }

    return result;
 }

void Deck::scanTrackInternal(const ITrack::Ptr trackToScan)
{
    auto scanningReader = utils::createAudioReaderFor(formatMgr, trackToScan);

    if (!scanningReader) {
        return;
    }

    logger->debug("Scanning");

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

    {
        auto providedCueOut = trackToScan->getCueOutPosition();

        if (providedCueOut < 0) {
            providedCueOut = m_metadata.getCueOut();
        }

        // Calculate trailing position if it was hinted from the track itself
        if (providedCueOut > 0) {
            trailingSamplePosition = (int64)(providedCueOut * scanningReader->sampleRate);

            // Reset, if the provided trailing is too far
            if ((trailingSamplePosition < 0) || (trailingSamplePosition > lastAudibleSamplePosition)) {
                trailingSamplePosition = -1;
            }
        }
    }

    // trailingSamplePosition is unknown, try to find
    if (trailingSamplePosition < 0) {
        trailingSamplePosition = findFadingPosition(scanningReader, tailPosition, lastAudibleSamplePosition - tailPosition);
    }

    trailingDuration = (trailingSamplePosition > -1) ? (lastAudibleSamplePosition - trailingSamplePosition) / scanningReader->sampleRate : 0;

    calculateTransition();

    disableNextTrackLeadIn = trackToScan->getDisableNextTrackLeadIn();

    if (trailingDuration > 0) {
        logger->debug(String::formatted(
            "Scanned - trailing@%.2f/%.2f duration=%.2f",
            trailingSamplePosition / scanningReader->sampleRate,
            totalSourceSamplesToPlay / scanningReader->sampleRate,
            trailingDuration
        ));
    } else {
        logger->debug("Scanned - no trailing found");
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
            transitionEndPosition = jmin(transitionStartPosition + maximumFadeOutDuration, (double)lastAudibleSamplePosition);
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

    transitionEnqueuePosition = jmax(0.0, transitionCuePosition - 1.0);

    if (transitionEnqueuePosition == transitionCuePosition) {
        transitionCuePosition = jmin(transitionEnqueuePosition + 1, transitionEndPosition);
        if (transitionCuePosition > transitionEndPosition) {
            transitionCuePosition = transitionEndPosition;
        }
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

        if (!started)
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
            started = false;
            inputStreamEOF = true;
        }

        stopped = !started;

        for (int i = info.buffer->getNumChannels(); --i >= 0;) {
            info.buffer->applyGainRamp(i, info.startSample, info.numSamples, lastGain, gain);
        }
    }
    else
    {
        info.clearActiveBufferRegion();
        stopped = true;
        fadingOut = false;
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
    logger->debug("Try to start playing");
    if ((!started || internallyPaused) && resamplerSource != nullptr)
    {
        if (!internallyPaused) {
            listeners.call([this](Callback& cb) {
                cb.deckStarted(*this, this->trackPlay);
            });
        }

        started = true;
        internallyPaused = false;
        stopped = false;
        fadingOut = false;
        inputStreamEOF = false;

        return true;
    }

    return started;
}

void Deck::stop()
{
    if (started)
    {
        started = false;
    }

    fadingOut = false;
}

void Deck::fireFinishedCallback()
{
    if (track == nullptr) {
        return;
    }

    logger->debug("Finished");

    listeners.call([this](Callback& cb) {
        cb.deckFinished(*this, this->trackPlay);
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
    if (!fadingOut || force) {
        transitionEnqueuePosition = getPosition();
        transitionCuePosition = transitionEnqueuePosition;
        transitionStartPosition = transitionCuePosition + 0.25;
        //
        transitionEndPosition = jmin(transitionStartPosition + jmin(3.0, maximumFadeOutDuration), getEndPosition());
        fadingOut = true;
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

        newBufferingSource = new BufferingAudioSource(newSource, readAheadThread, false, (int)(sourceSampleRate * 4), 2);
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
    started = false;

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
        try {
            auto ret = deck.loadTrackInternal(track);
            track = nullptr;
            callback(ret);
        }
        catch (...) {
            callback(false);
        }
        return 10;
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
    if (!deck.isTrackLoaded()) {
        return 250;
    }

    auto pos = deck.getPosition();
    if (lastPosition != pos) {
        deck.doPositionChange(pos);
        lastPosition = pos;
    }
    else {
        if (deck.stopped && deck.started) {
            // This is rare, something went wrong and playback was stalled somehow.
            // try to restart playback
            deck.started = false;
            deck.start();
        }
    }

    return deck.hasStarted() ? 10 : 250;
}

}
