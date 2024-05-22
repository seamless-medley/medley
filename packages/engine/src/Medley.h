#pragma once

#include <JuceHeader.h>

#include "ILogger.h"
#include "Deck.h"
#include "PostProcessor.h"
#include "Fader.h"
#include <list>

using namespace juce;

namespace medley {


class IQueue {
public:
    virtual size_t count() const = 0;
    virtual ITrack::Ptr fetchNextTrack() = 0;
};

class Medley : public Deck::Callback, juce::ChangeListener, public KaraokeParamController  {
public:
    class Callback : public Deck::Callback {
    public:
        typedef std::function<void(bool)> EnqueueNextDone;

        virtual void audioDeviceChanged() = 0;

        virtual void enqueueNext(EnqueueNextDone done = [](bool) { }) = 0;

        virtual void mainDeckChanged(Deck& sender, TrackPlay& track) = 0;
    };

    typedef AudioDeviceManager::AudioDeviceSetup AudioDeviceConfig;

    class AudioCallback {
    public:
        virtual void audioDeviceUpdate(juce::AudioIODevice* device, const AudioDeviceConfig& config) = 0;
        virtual void audioData(const AudioSourceChannelInfo& info, double timestamp) = 0;
    };

    class SupportedFormats : public AudioFormatManager
    {
    public:
        SupportedFormats();
    };

    static constexpr int numDecks = 3;

    Medley(IQueue& queue, ILoggerWriter* logWriter, bool skipDeviceScanning);

    virtual ~Medley();

    inline const auto& getAvailableDeviceTypes() {
        return deviceMgr.getAvailableDeviceTypes();
    }

    inline void setCurrentAudioDeviceType(AudioIODeviceType& type) {
        deviceMgr.setCurrentAudioDeviceType(type.getTypeName(), true);
    }

    inline void setCurrentAudioDeviceType(const juce::String& type) {
        deviceMgr.setCurrentAudioDeviceType(type, true);
    }

    inline auto getCurrentAudioDeviceType() const {
        return deviceMgr.getCurrentDeviceTypeObject();
    }

    inline auto getDeviceNames() const {
        return getCurrentAudioDeviceType()->getDeviceNames();
    }

    inline auto getIndexOfCurrentDevice() const {
        return getCurrentAudioDeviceType()->getIndexOfDevice(deviceMgr.getCurrentAudioDevice(), false);
    }

    inline auto getDefaultDeviceIndex() const {
        return getCurrentAudioDeviceType()->getDefaultDeviceIndex(false);
    }

    void setAudioDeviceByIndex(int index);

    inline AudioFormatManager& getAudioFormatManager() { return formatMgr; }

    inline AudioIODevice* getCurrentAudioDevice() const { return deviceMgr.getCurrentAudioDevice(); }

    inline AudioDeviceManager::AudioDeviceSetup getAudioDeviceSetup() const { return deviceMgr.getAudioDeviceSetup(); }

    int getOutputLatency();

    double getOutputSampleRate();

    inline Deck& getDeck1() const { return *decks[0]; }

    inline Deck& getDeck2() const { return *decks[1]; }

    inline Deck& getDeck3() const { return *decks[2]; }

    Deck* getDeck(int index = -1) const;

    Deck* getMainDeck() const;

    Deck* getNextDeck(Deck* from);

    Deck* getPreviousDeck(Deck* from);

    double getFadingCurve() const { return fadingCurve; }

    void setFadingCurve(double curve);

    bool play(bool shouldFade = true);

    void stop(bool shouldFade = true);

    bool isDeckPlaying();

    inline bool isPlaying() { return isDeckPlaying(); }

    void addListener(Callback* cb);

    void removeListener(Callback* cb);

    void setAudioCallback(AudioCallback* callback);

    inline void setVolume(float newVolume) { mixer.setVolume(newVolume); }

    inline float getVolume() const { return mixer.getVolume(); }

    bool togglePause(bool fade = true);

    inline bool isPaused() const { return mixer.isPaused(); }

    void setPositionFractional(double fraction, int deckIndex = -1);

    void setPosition(double time, int deckIndex = -1);

    double getDuration(int deckIndex = -1) const;

    double getPositionInSeconds(int deckIndex = -1) const;

    double getMinimumLeadingToFade() const { return minimumLeadingToFade; }

    void setMinimumLeadingToFade(double value) {
        minimumLeadingToFade = value;
    }

    double getMaximumFadeOutDuration() const { return maximumFadeOutDuration; }

    void setMaximumFadeOutDuration(double value);

    bool fadeOutMainDeck();

    double getCurrentTime() const { return mixer.currentTime; }

    double getLevel(int channel) {
        return mixer.processor.getLevel(channel);
    }

    double getPeakLevel(int channel) {
        return mixer.processor.getPeak(channel);
    }

    bool isClipping(int channel) {
        return mixer.processor.isClipping(channel);
    }

    /**
     * Reduction in dB
     */
    float getReduction() {
        return mixer.processor.getReduction();
    }

    void changeListenerCallback(ChangeBroadcaster* source) override;

    bool isTrackLoadable(const ITrack::Ptr track);

    void setReplayGainBoost(float decibels);

    float getReplayGainBoost() const { return decks[0]->getReplayGainBoost(); }

    bool isKaraokeEnabled() const override;

    bool setKaraokeEnabled(bool enabled, bool dontTransit = false) override;

    float getKaraokeParams(DeFXKaraoke::Param param) const override;

    float setKaraokeParams(DeFXKaraoke::Param param, float newValue) override;

private:
    friend class Deck;

    void loadNextTrack(Deck* currentDeck, bool play, Deck::OnLoadingDone done = [](bool) {});

    void deckTrackScanning(Deck& sender) override;

    void deckTrackScanned(Deck& sender) override;

    void deckStarted(Deck& sender, TrackPlay& track) override;

    void deckFinished(Deck& sender, TrackPlay& track) override;

    void deckLoaded(Deck& sender, TrackPlay& track) override;

    void deckUnloaded(Deck& sender, TrackPlay& track) override;

    void deckPosition(Deck& sender, double position) override;

    void doTransition(Deck* deck, double position);

    Deck* getAvailableDeck();

    juce::String getDeckName(Deck& deck);

    void updateFadingFactor();

    void updateTransition(Deck* deck);

    void dispatchAudio(const AudioSourceChannelInfo& info, double timestamp);

    class AudioInterceptor : public juce::TimeSliceClient {
    public:
        friend class Medley;

        AudioInterceptor(Medley& medley)
            : medley(medley)
        {

        }

        int useTimeSlice() override;

        void addBuffer(AudioBuffer<float>& buffer, int startSample, int numSamples);
    private:
        Medley& medley;
        CriticalSection lock;
        std::queue<AudioBuffer<float>> buffers;
    };

    class Mixer : public MixerAudioSource, public ChangeListener, public TimeSliceClient {
    public:
        friend class Medley;

        Mixer(Medley& medley)
            : MixerAudioSource(), medley(medley)
        {
            currentTime = Time::getMillisecondCounterHiRes();
            fader.alwaysResetTime(true);
        }

        bool togglePause(bool fade = true);

        void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

        inline bool isPaused() const { return paused; }

        void setPause(bool p, bool fade = true);

        void changeListenerCallback(ChangeBroadcaster* source) override;

        void updateAudioConfig();

        int useTimeSlice() override;

        void fadeOut(double durationMs, Fader::OnDone callback);

        float getVolume() const { return processor.getVolume(); }

        void setVolume(float newVolume) { processor.setVolume(newVolume); }

    private:
        Medley& medley;

        bool prepared = false;
        int numChannels = 2;
        int sampleRate = 44100;
        bool paused = false;
        bool stalled = false;
        bool outputStarted = false;

        double currentTime = 0;

        float faderGain = 1.0f;
        float lastFaderGain = 1.0f;

        Fader fader;

        AudioBuffer<float> tapBuffer;

        PostProcessor processor;
    };

    AudioDeviceManager deviceMgr;

    SupportedFormats formatMgr;

    Deck* decks[numDecks]{};

    AudioInterceptor audioInterceptor;

    Mixer mixer;
    AudioSourcePlayer mainOut;

    IQueue& queue;

    TimeSliceThread loadingThread;
    TimeSliceThread readAheadThread;
    TimeSliceThread visualizationThread;
    TimeSliceThread audioInterceptionThread;

    bool keepPlaying = false;

    Deck* transitingFromDeck = nullptr;

    enum class DeckTransitionState {
        Idle,
        Enqueue,
        CueNext,
        NextIsLoading,
        NextIsReady,
        TransitToNext
    };

    struct deck_transition_t {
        deck_transition_t()
            : fader(1.0)
        {

        }

        DeckTransitionState state = DeckTransitionState::Idle;
        Fader fader;
    };

    deck_transition_t decksTransition[numDecks]{};

    double fadingCurve = 60;
    float fadingFactor{};

    double minimumLeadingToFade = 2.5;
    double maximumFadeOutDuration{};

    int forceFadingOut = 0;

    CriticalSection callbackLock;
    ListenerList<Callback> listeners;

    CriticalSection audioCallbackLock;
    AudioCallback* audioCallback = nullptr;

    ILoggerWriter* logWriter;
    std::unique_ptr<Logger> logger;
};

}
