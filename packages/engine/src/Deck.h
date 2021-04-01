#pragma once

#include <JuceHeader.h>
#include "ITrack.h"

using namespace juce;

namespace medley {

class Deck : public PositionableAudioSource {
public:
    class Callback {
    public:
        virtual void deckTrackScanning(Deck& sender) = 0;

        virtual void deckTrackScanned(Deck& sender) = 0;

        virtual void deckPosition(Deck& sender, double position) = 0;

        virtual void deckStarted(Deck& sender) = 0;

        virtual void deckFinished(Deck& sender) = 0;

        virtual void deckLoaded(Deck& sender) = 0;

        virtual void deckUnloaded(Deck& sender) = 0;
    };

    typedef std::function<void(bool)> LoadDone;

    Deck(const String& name, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread);

    ~Deck() override;

    const String& getName() const { return name; }

    double getDuration() const;

    double getPositionInSeconds() const;

    void loadTrack(const ITrack::Ptr track/*, bool play*/, LoadDone done = [](bool) {});

    void unloadTrack();

    bool isTrackLoaded() const { return source != nullptr; }

    void setPosition(double newPosition);

    void setPositionFractional(double fraction);

    bool isPlaying() const noexcept { return playing; }

    void addListener(Callback* cb);

    void removeListener(Callback* cb);

    void prepareToPlay(int samplesPerBlockExpected, double newSampleRate) override;

    void releaseResources() override;

    void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

    bool hasStreamFinished() const noexcept { return inputStreamEOF; }

    void setNextReadPosition(int64 newPosition) override;

    int64 getNextReadPosition() const override;

    int64 getTotalLength() const override;

    bool isLooping() const override;

    ITrack::Ptr getTrack() const { return track; }

    bool start();

    void stop();

    float getVolume() const { return volume; }

    float getPregain() const { return pregain; }

    void setPregain(float newPre) {
        pregain = newPre;
        updateGain();
    }

    void updateGain();

    double getSampleRate() const { return sampleRate; }

    double getSourceSampleRate() const { return sourceSampleRate; }

    double getTransitionPreCuePosition() const { return transitionPreCuePosition; }

    double getTransitionCuePosition() const { return transitionCuePosition; }

    double getTransitionStartPosition() const { return transitionStartPosition; }

    double getTransitionEndPosition() const { return transitionEndPosition; }

    double getMaxTransitionTime() const { return maxTransitionTime; }

    void setMaxTransitionTime(double duration);

    double getFirstAudiblePosition() const;

    double getEndPosition() const;

    int64 getLeadingSamplePosition() const { return leadingSamplePosition; }

    double getLeadingDuration() const { return leadingDuration; }

    int64 getTrailingSamplePosition() const { return trailingPosition; }

    double getTrailingDuration() const { return trailingDuration; }

    // bool shouldPlayAfterLoading() const { return playAfterLoading; }

    inline bool isMain() const { return main; }

    inline bool isFading() const { return fading; }

private:
    friend class Medley;

    class Loader : public TimeSliceClient {
    public:
        Loader(Deck& deck) : deck(deck) {}
        ~Loader() override;
        int useTimeSlice() override;

        void load(const ITrack::Ptr track, LoadDone done);
    private:
        Deck& deck;
        ITrack::Ptr track = nullptr;
        LoadDone done;
        CriticalSection lock;
    };

    class Scanner : public TimeSliceClient {
    public:
        Scanner(Deck& deck) : deck(deck) {}
        int useTimeSlice() override;

        void scan(const ITrack::Ptr track);
    private:
        Deck& deck;
        ITrack::Ptr track = nullptr;
    };

    class PlayHead : public TimeSliceClient {
    public:
        PlayHead(Deck& deck) : deck(deck) {}
        int useTimeSlice() override;
    private:
        Deck& deck;
        double lastPosition = 0;
    };

    void setVolume(float newVolume) {
        volume = newVolume;
        updateGain();
    }

    void setSource(AudioFormatReaderSource* newSource);

    void releaseChainedResources();

    bool loadTrackInternal(const ITrack::Ptr track);

    void unloadTrackInternal();

    void scanTrackInternal(const ITrack::Ptr trackToScan);

    void calculateTransition();

    void firePositionChangeCalback(double position);

    void fireFinishedCallback();

    void setGain(float newGain) noexcept {
        gain = newGain;
    }

    float getGain() const noexcept { return gain; }

    inline double getSampleInSeconds(int64 sample) {
        if (sampleRate > 0.0)
            return (double)sample / sampleRate;

        return 0.0;
    }

    inline void markAsMain(const bool mark) {
        main = mark;
    }

    void fadeOut();

    bool isTrackLoading = false;
    ITrack::Ptr track = nullptr;

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

    CriticalSection sourceLock;
    //
    ListenerList<Callback> listeners;
    //
    String name;
    Loader loader;
    // bool playAfterLoading = false;

    Scanner scanningScheduler;
    PlayHead playhead;

    int64 firstAudibleSamplePosition = 0;
    int64 lastAudibleSamplePosition = 0;
    int64 totalSamplesToPlay = 0;

    int64 leadingSamplePosition = 0;
    double leadingDuration = 0.0;

    int64 trailingPosition = 0;
    double trailingDuration = 0.0;

    double transitionPreCuePosition = 0.0;
    double transitionCuePosition = 0.0;
    double transitionStartPosition = 0.0;
    double transitionEndPosition = 0.0;

    double maxTransitionTime = 3.0;

    bool main = false;

    bool fading = false;
};

}

