#include "Deck.h"

namespace {
    static const auto kHeadRoomDecibel = 3.0f;
    static const auto kSilenceThreshold = Decibels::decibelsToGain(-60.0f);
    static const auto kEndingSilenceThreshold = Decibels::decibelsToGain(-45.0f);
    static const auto kFadingSilenceThreshold = Decibels::decibelsToGain(-20.0f);

    constexpr float kFirstSoundDuration = 0.001f;
    constexpr float kLastSoundDuration = 1.25f;
    constexpr float kLastSoundScanningDurartion = 20.0f;
}

Deck::Deck(const String& name, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread)
    :
    name(name),
    loader(*this),
    scanningScheduler(*this),
    playhead(*this),
    formatMgr(formatMgr),
    loadingThread(loadingThread),
    readAheadThread(readAheadThread)
{
    loadingThread.addTimeSliceClient(&loader);
    loadingThread.addTimeSliceClient(&scanningScheduler);
    readAheadThread.addTimeSliceClient(&playhead);
}

Deck::~Deck() {    
    releaseChainedResources();
    unloadTrackInternal();
}

double Deck::getLengthInSeconds() const
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

void Deck::loadTrack(const File& file, bool play)
{
    playAfterLoading = play;
    loader.load(file);

    this->file = file;
}

void Deck::unloadTrack()
{
    setSource(nullptr);
    unloadTrackInternal();
}

void Deck::loadTrackInternal(File* file)
{
    if (!file->existsAsFile()) {
        return;
    }

    auto newReader = formatMgr.createReaderFor(*file);

    if (!newReader) {
        return;
    }

    unloadTrackInternal();
    reader = newReader;

    auto mid = reader->lengthInSamples / 2;
    firstAudibleSoundPosition = jmax(0i64, reader->searchForLevel(0, mid, kSilenceThreshold, 1.0, (int)(reader->sampleRate * kFirstSoundDuration)));
    totalSamplesToPlay = reader->lengthInSamples;
    lastAudibleSoundPosition = totalSamplesToPlay;

    Range<float> maxLevels[2]{};
    reader->readMaxLevels(firstAudibleSoundPosition, (int)(reader->sampleRate * 10), maxLevels, 2);

    auto leadingDecibel = Decibels::gainToDecibels((maxLevels[0].getEnd() + maxLevels[1].getEnd()) / 2.0f);
    auto leadingLevel = jlimit(0.0f, 0.9f, Decibels::decibelsToGain(leadingDecibel - 3.0f));

    leadingPosition = reader->searchForLevel(
        firstAudibleSoundPosition,
        (int)(reader->sampleRate * 10.0),
        leadingLevel, 1.0,
        (int)(reader->sampleRate * kFirstSoundDuration / 10)
    );

    if (leadingPosition > -1) {
        auto lead2 = reader->searchForLevel(
            jmax(0i64, leadingPosition - (int)(reader->sampleRate * 2.0)),
            (int)(reader->sampleRate * 2.0),
            leadingLevel * 0.33, 1.0,
            0
        );

        if ((lead2 > firstAudibleSoundPosition) && (lead2 < leadingPosition)) {
            leadingPosition = lead2;
        }
    }

    leadingDuration = (leadingPosition > -1) ? (leadingPosition - firstAudibleSoundPosition) / reader->sampleRate : 0;

    DBG(String::formatted("leadingDuration=%.2f, leadingPosition=%d", leadingDuration, leadingPosition));

    setSource(new AudioFormatReaderSource(reader, false));

    {
        ScopedLock sl(callbackLock);
        listeners.call([this](Callback& cb) {
            cb.deckLoaded(*this);
        });
    }

    scanningScheduler.scan();

    if (playAfterLoading) {
        start();
    }
}


void Deck::unloadTrackInternal()
{
    inputStreamEOF = false;
    playing = false;
    stopped = true;

    bool deckUnloaded = false;

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

    if (deckUnloaded) {
        const ScopedLock sl(callbackLock);
        listeners.call([this](Callback& cb) {
            cb.deckUnloaded(*this);
        });
    }

    pregain = 1.0f;
    volume = 1.0f;
    updateGain();
}

void Deck::scanTrackInternal()
{
    if (!file.existsAsFile()) {
        return;
    }

    auto scanningReader = formatMgr.createReaderFor(file);

    auto middlePosition = scanningReader->lengthInSamples / 2;
    auto tailPosition = jmax(
        firstAudibleSoundPosition,
        middlePosition,
        (int64)(scanningReader->lengthInSamples - scanningReader->sampleRate * kLastSoundScanningDurartion)
    );

    auto silencePosition = scanningReader->searchForLevel(
        tailPosition,
        scanningReader->lengthInSamples - tailPosition,
        0, kEndingSilenceThreshold,
        (int)(scanningReader->sampleRate * kLastSoundDuration)
    );

    if (silencePosition > firstAudibleSoundPosition) {
        lastAudibleSoundPosition = silencePosition;

        auto endPosition = scanningReader->searchForLevel(
            silencePosition,
            scanningReader->lengthInSamples - silencePosition,
            0, kSilenceThreshold,
            (int)(scanningReader->sampleRate * 0.004)
        );

        if (endPosition > lastAudibleSoundPosition) {
            totalSamplesToPlay = endPosition;
        }
    }

    trailingPosition = scanningReader->searchForLevel(
        tailPosition,
        totalSamplesToPlay - tailPosition,
        0, kFadingSilenceThreshold,
        (int)(scanningReader->sampleRate * 0.5)
    );

    trailingDuration = (trailingPosition > -1) ? (totalSamplesToPlay - trailingPosition) / scanningReader->sampleRate : 0;

    delete scanningReader;

    calculateTransition();

    listeners.call([this](Callback& cb) {
        cb.deckTrackScanned(*this);
    });
}

void Deck::calculateTransition()
{
    transitionStartPosition = lastAudibleSoundPosition / sourceSampleRate;
    transitionEndPosition = transitionStartPosition;
    
    if (transitionTime > 0.0)
    {        

        if (trailingDuration >= transitionTime) {
            transitionStartPosition = trailingPosition / sourceSampleRate;
            transitionEndPosition = transitionStartPosition + transitionTime;
        }
        else {
            transitionStartPosition = jmax(2.0, transitionStartPosition - trailingDuration);
            transitionEndPosition = transitionStartPosition + trailingDuration;
        }
        
        transitionCuePosition = jmax(0.0, transitionStartPosition - 8.0);
    }
}

void Deck::firePositionChangeCalback(double position)
{
    const ScopedLock sl(callbackLock);

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
    setPosition(getLengthInSeconds() * fraction);
}

void Deck::getNextAudioBlock(const AudioSourceChannelInfo& info)
{    
    const ScopedLock sl(callbackLock);

    bool wasPlaying = playing;    

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
    }

    lastGain = gain;

    if (wasPlaying && !playing) {
        DBG("STOPPED");

        listeners.call([this](Callback& cb) {
            cb.deckFinished(*this);
        });

        unloadTrackInternal();
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
    const ScopedLock sl(callbackLock);

    if (bufferingSource != nullptr)
    {
        const double ratio = (sampleRate > 0 && sourceSampleRate > 0) ? sampleRate / sourceSampleRate : 1.0;
        return (int64)((double)bufferingSource->getTotalLength() * ratio);
    }

    return 0;
}

bool Deck::isLooping() const
{
    const ScopedLock sl(callbackLock);
    return bufferingSource != nullptr && bufferingSource->isLooping();
}

void Deck::start()
{
    if ((!playing) && resamplerSource != nullptr)
    {
        {
            const ScopedLock sl(callbackLock);
            playing = true;
            stopped = false;
            inputStreamEOF = false;

            listeners.call([this](Callback& cb) {
                cb.deckStarted(*this);
            });
        }
    }
    else {
        // Something went wrong
        jassertfalse;
    }
}

void Deck::stop()
{
    if (playing)
    {
        playing = false;

        int n = 500;
        while (--n >= 0 && !stopped)
            Thread::sleep(2);
    }
}

void Deck::updateGain()
{
    gain = pregain * volume;
}

void Deck::setTransitionTime(double duration)
{
    transitionTime = duration;
    calculateTransition();
}


void Deck::addListener(Callback* cb) {
    ScopedLock sl(callbackLock);
    listeners.add(cb);
}

void Deck::prepareToPlay(int samplesPerBlockExpected, double newSampleRate)
{
    const ScopedLock sl(callbackLock);

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
        newBufferingSource->setNextReadPosition(firstAudibleSoundPosition);

        newResamplerSource = new ResamplingAudioSource(newBufferingSource, false, 2);

        if (isPrepared)
        {
            newResamplerSource->setResamplingRatio(sourceSampleRate / sampleRate);
            newResamplerSource->prepareToPlay(blockSize, sampleRate);
        }
    }

    {
        const ScopedLock sl(callbackLock);
        source = newSource;
        bufferingSource = newBufferingSource;
        resamplerSource = newResamplerSource;        

        inputStreamEOF = false;
        playing = false;
    }

    if (oldResamplerSource != nullptr) {
        oldResamplerSource->releaseResources();
    }

    if (newSource != nullptr) {
        calculateTransition();
    }
}

void Deck::releaseChainedResources()
{
    const ScopedLock sl(callbackLock);

    if (resamplerSource != nullptr) {
        resamplerSource->releaseResources();
    }

    isPrepared = false;
}

Deck::Loader::~Loader()
{
    if (file) {
        delete file;
        file = nullptr;
    }
}

int Deck::Loader::useTimeSlice()
{
    ScopedLock sl(lock);

    if (file != nullptr) {
        deck.loadTrackInternal(file);

        delete file;
        file = nullptr;
    }

    return 100;
}

void Deck::Loader::load(const File& file)
{
    ScopedLock sl(lock);

    if (this->file) {
        delete this->file;
    }

    this->file = new File(file);
}

int Deck::Scanner::useTimeSlice()
{
    if (shouldScan) {
        deck.scanTrackInternal();
        shouldScan = false;
    }

    return 100;
}

void Deck::Scanner::scan()
{
    shouldScan = true;
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
