#pragma once

#include <JuceHeader.h>

using namespace juce;

class Deck : public PositionableAudioSource {
public:
    class Callback {
    public:
        virtual void deckTrackScanned(Deck& sender) = 0;

        virtual void deckPosition(Deck& sender, double position) = 0;

        virtual void deckStarted(Deck& sender) = 0;

        virtual void deckFinished(Deck& sender) = 0;

        virtual void deckLoaded(Deck& sender) = 0;

        virtual void deckUnloaded(Deck& sender) = 0;
    };

    Deck(const String& name, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread);

    ~Deck() override;

    const String& getName() const { return name; }

    double getLengthInSeconds() const;

    double getPositionInSeconds() const;

    void loadTrack(const File& file, bool play);

    void unloadTrack();

    bool isTrackLoaded() const { return reader != nullptr; }

    void setPosition(double newPosition);

    void setPositionFractional(double fraction);

    bool isPlaying() const noexcept { return playing; }

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

    float getVolume() const { return volume; }

    void setVolume(float newVolume) {
        volume = newVolume;
        updateGain();
    }

    float getPregain() const { return pregain; }

    void setPregain(float newPre) {
        pregain = newPre;
        updateGain();
    }

    void updateGain();

    double getSampleRate() const { return sampleRate; }

    double getTransitionCuePosition() const { return transitionCuePosition; }

    double getTransitionStartPosition() const { return transitionStartPosition; }

    double getTransitionEndPosition() const { return transitionEndPosition; }

    double getTransitionTime() const { return transitionTime; }

    void setTransitionTime(double duration);

    int64 getLeadingPosition() const { return leadingPosition; }

    double getLeadingDuration() const { return leadingDuration; }

    bool shouldPlayAfterLoading() const { return playAfterLoading; }

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
        bool shouldScan = false;
    };

    class PlayHead : public TimeSliceClient {
    public:
        PlayHead(Deck& deck) : deck(deck) {}
        int useTimeSlice() override;
    private:
        Deck& deck;
        double lastPosition = 0;
    };

    void setSource(AudioFormatReaderSource* newSource);

    void releaseChainedResources();

    void loadTrackInternal(File* file);

    void unloadTrackInternal();

    void scanTrackInternal();

    void calculateTransition();

    void firePositionChangeCalback(double position);

    void setGain(float newGain) noexcept {
        gain = newGain;
    }

    float getGain() const noexcept { return gain; }

    inline double getSampleInSeconds(int64 sample) {
        if (sampleRate > 0.0)
            return (double)sample / sampleRate;

        return 0.0;
    }

    File file;

    std::atomic<bool> playing{ false };
    std::atomic<bool> stopped{ true };

    double sampleRate = 44100.0;
    double sourceSampleRate = 0;

    float pregain = 1.0f;
    float volume = 1.0f;
    //
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
    String name;
    Loader loader;
    bool playAfterLoading = false;

    Scanner scanningScheduler;
    PlayHead playhead;

    int64 firstAudibleSoundPosition = 0;
    int64 lastAudibleSoundPosition = 0;
    int64 totalSamplesToPlay = 0;

    int64 leadingPosition = 0;
    double leadingDuration = 0.0;

    int64 trailingPosition = 0;
    double trailingDuration = 0.0;

    double transitionCuePosition = 0.0;
    double transitionStartPosition = 0.0;
    double transitionEndPosition = 0.0;

    double transitionTime = 3.0;
};

