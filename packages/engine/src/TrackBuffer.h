#pragma once

#include <JuceHeader.h>

using namespace juce;

class TrackBuffer : public PositionableAudioSource {
public:
    class Callback {
    public:
        virtual void finished(TrackBuffer& sender) = 0;

        virtual void unloaded(TrackBuffer& sender) = 0;
    };

    TrackBuffer(AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread);

    ~TrackBuffer() override;

    double getLengthInSeconds() const;

    void loadTrack(const File& file, bool play);

    void unloadTrack();

    bool isTrackLoaded() const { return reader != nullptr; }

    void setPosition(double newPosition);

    void setPositionFractional(double fraction);

    bool isPlaying() const noexcept { return playing; }

    void setGain(float newGain) noexcept {
        gain = newGain;
    }

    float getGain() const noexcept { return gain; }

    void addListener(Callback* cb);

    void prepareToPlay(int samplesPerBlockExpected, double newSampleRate) override;

    void releaseResources() override;

    void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

    bool hasStreamFinished() const noexcept { return inputStreamEOF; }

    void setNextReadPosition(int64 newPosition) override;

    int64 getNextReadPosition() const override;

    int64 getTotalLength() const override;

    bool isLooping() const override;

    void start();

    void stop();

private:
    class TrackLoader : public TimeSliceClient {
    public:
        TrackLoader(TrackBuffer& tb) : tb(tb) {}
        ~TrackLoader() override;
        int useTimeSlice() override;

        void load(const File& file);
    private:
        TrackBuffer& tb;
        File* file = nullptr;
        CriticalSection lock;
    };

    class TrackScanningScheduler : public TimeSliceClient {
    public:
        TrackScanningScheduler(TrackBuffer& tb) : tb(tb) {}
        int useTimeSlice() override;

        void scan();
    private:
        TrackBuffer& tb;
        bool doScan = false;
    };

    void setSource(AudioFormatReaderSource* newSource);

    void releaseChainedResources();

    void loadTrackInternal(File* file);

    void unloadTrackInternal();

    void scanTrackInternal();

    File file;

    std::atomic<bool> playing{ false };
    std::atomic<bool> stopped{ true };

    double sampleRate = 44100.0;
    double sourceSampleRate = 0;

    float gain = 1.0f;
    float lastGain = 1.0f;

    AudioFormatManager& formatMgr;
    TimeSliceThread& loadingThread;
    TimeSliceThread& readAheadThread;

    AudioFormatReader* reader = nullptr;
    AudioFormatReaderSource* source = nullptr;
    ResamplingAudioSource* resamplerSource = nullptr;
    BufferingAudioSource* bufferingSource = nullptr;

    int blockSize = 128;
    bool isPrepared = false;
    bool inputStreamEOF = false;

    CriticalSection callbackLock;
    //
    ListenerList<Callback> listeners;
    //
    TrackLoader loader;
    bool playAfterLoading = false;

    TrackScanningScheduler scanningScheduler;

    int64 firstAudibleSoundPosition = 0;
    int64 lastAudibleSoundPosition = 0;
    int64 totalSamplesToPlay = 0;
};

