#pragma once

#include <JuceHeader.h>

using namespace juce;

class Deck : public PositionableAudioSource {
public:
    class Callback {
    public:
        virtual void finished(Deck& sender) = 0;

        virtual void unloaded(Deck& sender) = 0;
    };

    Deck(AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread);

    ~Deck() override;

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
    class Loader : public TimeSliceClient {
    public:
        Loader(Deck& deck) : deck(deck) {}
        ~Loader() override;
        int useTimeSlice() override;

        void load(const File& file);
    private:
        Deck& deck;
        File* file = nullptr;
        CriticalSection lock;
    };

    class Scanner : public TimeSliceClient {
    public:
        Scanner(Deck& deck) : deck(deck) {}
        int useTimeSlice() override;

        void scan();
    private:
        Deck& deck;
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
    Loader loader;
    bool playAfterLoading = false;

    Scanner scanningScheduler;

    int64 firstAudibleSoundPosition = 0;
    int64 lastAudibleSoundPosition = 0;
    int64 totalSamplesToPlay = 0;
};

