#include "Deck.h"

namespace {
    static const auto kSilenceThreshold = Decibels::decibelsToGain(-60.0f);
    static const auto kEndingSilenceThreshold = Decibels::decibelsToGain(-45.0f);

    constexpr float kFirstSoundDuration = 1e-3f;
    constexpr float kLastSoundDuration = 1.25f;
    constexpr float kLastSoundScanningDurartion = 30.0f;
}

Deck::Deck(AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread)
    :
    loader(*this),
    scanningScheduler(*this),
    formatMgr(formatMgr),
    loadingThread(loadingThread),
    readAheadThread(readAheadThread)
{
    loadingThread.addTimeSliceClient(&loader);
    loadingThread.addTimeSliceClient(&scanningScheduler);
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
    auto newReader = formatMgr.createReaderFor(*file);

    if (!newReader) {
        return;
    }

    unloadTrackInternal();
    reader = newReader;

    auto mid = reader->lengthInSamples / 2;
    firstAudibleSoundPosition = jmax(0i64, reader->searchForLevel(0, mid, kSilenceThreshold, 1.0f, reader->sampleRate * kFirstSoundDuration));
    totalSamplesToPlay = reader->lengthInSamples;
    lastAudibleSoundPosition = totalSamplesToPlay;

    setSource(new AudioFormatReaderSource(newReader, false));

    scanningScheduler.scan();

    if (playAfterLoading) {
        start();
    }
}


void Deck::unloadTrackInternal()
{
    inputStreamEOF = false;
    playing = false;

    bool unloaded = false;

    if (resamplerSource) {
        delete resamplerSource;
        resamplerSource = nullptr;
        unloaded = true;
    }

    if (bufferingSource) {
        delete bufferingSource;
        bufferingSource = nullptr;
        unloaded = true;
    }

    if (source) {
        delete source;
        source = nullptr;
        unloaded = true;
    }

    if (reader) {
        delete reader;
        reader = nullptr;
        unloaded = true;
    }

    if (unloaded) {
        const ScopedLock sl(callbackLock);
        listeners.call([this](Callback& cb) {
            cb.unloaded(*this);
        });
    }
}

void Deck::scanTrackInternal()
{
    if (file.existsAsFile()) {
        auto scanningReader = formatMgr.createReaderFor(file);
        auto mid = scanningReader->lengthInSamples / 2;

        DBG("Old lastAudibleSoundPosition=" + String(lastAudibleSoundPosition/scanningReader->sampleRate));

        auto silencePosition = scanningReader->searchForLevel(
            jmax(firstAudibleSoundPosition, mid, (int64)(scanningReader->lengthInSamples - scanningReader->sampleRate * kLastSoundScanningDurartion)),
            scanningReader->lengthInSamples,
            0, kEndingSilenceThreshold,
            scanningReader->sampleRate * kLastSoundDuration
        );

        if (silencePosition > firstAudibleSoundPosition) {
            lastAudibleSoundPosition = silencePosition;

            DBG("New lastAudibleSoundPosition=" + String(lastAudibleSoundPosition / scanningReader->sampleRate));

            auto endPosition = scanningReader->searchForLevel(
                silencePosition,
                scanningReader->lengthInSamples,
                0, kSilenceThreshold,
                scanningReader->sampleRate * 0.004
            );

            if (endPosition > lastAudibleSoundPosition) {
                totalSamplesToPlay = endPosition;
                DBG("New ending=" + String(totalSamplesToPlay / scanningReader->sampleRate));
            }
        }        

        delete scanningReader;
    }
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
        // DBG("Position: " + String(getNextReadPosition()));
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
            cb.finished(*this);
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
        }
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

        newBufferingSource = new BufferingAudioSource(newSource, readAheadThread, false, sourceSampleRate * 2, 2);

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
    if (doScan) {
        deck.scanTrackInternal();
        doScan = false;
    }

    return 100;
}

void Deck::Scanner::scan()
{
    doScan = true;
}
