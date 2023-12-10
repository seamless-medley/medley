#pragma once

#include <JuceHeader.h>
#include "ITrack.h"
#include "Metadata.h"
#include "ILogger.h"

using namespace juce;

namespace medley {

class Deck : public PositionableAudioSource {
public:
    class Callback {
    public:
        virtual void deckTrackScanning(Deck& sender) = 0;

        virtual void deckTrackScanned(Deck& sender) = 0;

        virtual void deckPosition(Deck& sender, double position) = 0;

        virtual void deckStarted(Deck& sender, TrackPlay& track) = 0;

        virtual void deckFinished(Deck& sender, TrackPlay& track) = 0;

        virtual void deckLoaded(Deck& sender, TrackPlay& track) = 0;

        virtual void deckUnloaded(Deck& sender, TrackPlay& track) = 0;
    };

    typedef std::function<void(bool)> OnLoadingDone;

    Deck(uint8_t index, const juce::String& name, ILoggerWriter* logWriter, AudioFormatManager& formatMgr, TimeSliceThread& loadingThread, TimeSliceThread& readAheadThread);

    ~Deck() override;

    const juce::String& getName() const { return name; }

    inline int getIndex() const { return index; }

    double getDuration() const;

    double getPosition() const;

    void loadTrack(const ITrack::Ptr track, OnLoadingDone callback = [](bool) {});

    void unloadTrack();

    bool isTrackLoaded() const { return source != nullptr; }

    void setPosition(double time);

    void setPositionFractional(double fraction);

    bool isPlaying() const noexcept { return playing && !internallyPaused; }

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

    TrackPlay& getTrackPlay() { return trackPlay; }

    bool start();

    void stop();

    float getVolume() const { return volume; }

    void setReplayGainBoost(float decibels) {
        replayGainBoost = decibels;
        setReplayGain(replayGain);
    }

    inline float getReplayGainBoost() const { return replayGainBoost; }

    double getSampleRate() const { return sampleRate; }

    double getSourceSampleRate() const { return sourceSampleRate; }

    double getTransitionEnqueuePosition() const { return transitionEnqueuePosition; }

    double getTransitionCuePosition() const { return transitionCuePosition; }

    double getTransitionStartPosition() const { return transitionStartPosition; }

    double getTransitionEndPosition() const { return transitionEndPosition; }

    double getMaximumFadeOutDuration() const { return maximumFadeOutDuration; }

    void setMaximumFadeOutDuration(double duration);

    double getFirstAudiblePosition() const;

    double getLastAudiblePosition() const;

    double getEndPosition() const;

    int64 getLeadingSamplePosition() const { return leadingSamplePosition; }

    double getLeadingDuration() const { return leadingDuration; }

    int64 getTrailingSamplePosition() const { return trailingSamplePosition; }

    double getTrailingDuration() const { return trailingDuration; }

    inline bool isMain() const { return main; }

    inline bool isFading() const { return fading; }

    const Metadata& metadata() const {
        return m_metadata;
    }

private:
    friend class Medley;

    class Loader : public TimeSliceClient {
    public:
        Loader(Deck& deck) : deck(deck) {}
        ~Loader() override;
        int useTimeSlice() override;

        void load(const ITrack::Ptr track, OnLoadingDone callback);
    private:
        Deck& deck;
        ITrack::Ptr track = nullptr;
        OnLoadingDone callback;
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
        gain = gainCorrection * volume;
    }

    void setReplayGain(float rg);

    void setSource(AudioFormatReaderSource* newSource);

    void releaseChainedResources();

    bool loadTrackInternal(const ITrack::Ptr track);

    void unloadTrackInternal();

    void scanTrackInternal(const ITrack::Ptr trackToScan);

    void calculateTransition();

    void doPositionChange(double position);

    void fireFinishedCallback();

    inline double getSampleInSeconds(int64 sample) {
        if (sampleRate > 0.0)
            return (double)sample / sampleRate;

        return 0.0;
    }

    inline void markAsMain(const bool mark) {
        main = mark;
    }

    void log(medley::LogLevel level, const juce::String& s);

    void fadeOut(bool force = false);

    void internalPause() {
        internallyPaused = true;
    }

    int64 findBoring(AudioFormatReader* reader, int64 startSample, int64 endSample);

    int64 findFadingPosition(AudioFormatReader* reader, int64 startSample, int64 numSamples);

    bool isTrackLoading = false;
    ITrack::Ptr track = nullptr;
    TrackPlay trackPlay;

    std::atomic<bool> playing{ false };
    std::atomic<bool> internallyPaused{ false };
    std::atomic<bool> stopped{ true };

    double sampleRate = 44100.0;
    double sourceSampleRate = 0;
    int64 nextReadPosition = 0;

    float replayGain = 0.0f;
    float gainCorrection = 1.0f;
    float volume = 1.0f;
    float replayGainBoost = 9.0;
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
    uint8_t index;
    juce::String name;
    Loader loader;

    Scanner scanner;
    PlayHead playhead;

    int64 firstAudibleSamplePosition = 0;
    int64 lastAudibleSamplePosition = 0;
    int64 totalSourceSamplesToPlay = 0;

    int64 leadingSamplePosition = 0;
    double leadingDuration = 0.0;

    int64 trailingSamplePosition = 0;
    double trailingDuration = 0.0;

    double transitionEnqueuePosition = 0.0;
    double transitionCuePosition = 0.0;
    double transitionStartPosition = 0.0;
    double transitionEndPosition = 0.0;

    double maximumFadeOutDuration = 3.0;

    bool disableNextTrackLeadIn = false;

    bool main = false;

    bool fading = false;

    Metadata m_metadata;

    std::unique_ptr<Logger> logger;
};

}

