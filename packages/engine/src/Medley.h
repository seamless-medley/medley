#pragma once

#include <JuceHeader.h>

#include "Deck.h"
#include "PostProcessor.h"
#include "LevelTracker.h"
#include <list>

using namespace juce;

namespace medley {


class IQueue {
public:
    virtual size_t count() const = 0;
    virtual ITrack::Ptr fetchNextTrack() = 0;
};

class Medley : public Deck::Callback, juce::ChangeListener {
public:
    class Callback : public Deck::Callback {
    public:
        typedef std::function<void(bool)> PreCueNextDone;

        virtual void audioDeviceChanged() = 0;

        virtual void preCueNext(PreCueNextDone done = [](bool) { }) = 0;
    };

    Medley(IQueue& queue);

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

    inline const AudioFormatManager& getAudioFormatManager() const { return formatMgr; }

    inline const AudioIODevice* getCurrentAudioDevice() const { return deviceMgr.getCurrentAudioDevice(); }

    inline Deck& getDeck1() const { return *deck1; }

    inline Deck& getDeck2() const { return *deck2; }

    Deck* getMainDeck() const;

    Deck* getAnotherDeck(Deck* from);

    double getFadingCurve() const { return fadingCurve; }

    void setFadingCurve(double curve);

    void play();

    void stop();

    bool isDeckPlaying();

    inline bool isPlaying() { return isDeckPlaying(); }

    void addListener(Callback* cb);

    void removeListener(Callback* cb);

    inline void setGain(float newGain) { mainOut.setGain(newGain); }

    inline float getGain() const { return mainOut.getGain(); }

    inline bool togglePause() { return mixer.togglePause(); }

    inline bool isPaused() const { return mixer.isPaused(); }

    void setPositionFractional(double fraction);

    void setPositionInSeconds(double time);

    double getDuration() const;

    double getPositionInSeconds() const;

    double getMaxLeadingDuration() const { return maxLeadingDuration; }

    void setMaxLeadingDuration(double value) {
        maxLeadingDuration = value;
    }

    double getMaxTransitionTime() const { return maxTransitionTime; }

    void setMaxTransitionTime(double value);

    void fadeOutMainDeck();

    inline double getLevel(int channel) {
        return mixer.getLevel(channel);
    }

    inline double getPeakLevel(int channel) {
        return mixer.getPeak(channel);
    }

    inline bool isClipping(int channel) {
        return mixer.isClipping(channel);
    }

    void changeListenerCallback(ChangeBroadcaster* source) override;

    bool isTrackLoadable(const ITrack::Ptr track);

private:
    bool loadNextTrack(Deck* currentDeck, bool play);

    void deckTrackScanning(Deck& sender) override;

    void deckTrackScanned(Deck& sender) override;

    void deckStarted(Deck& sender) override;

    void deckFinished(Deck& sender) override;

    void deckLoaded(Deck& sender) override;

    void deckUnloaded(Deck& sender) override;

    void deckPosition(Deck& sender, double position) override;

    Deck* getAvailableDeck();

    juce::String getDeckName(Deck& deck);

    void updateFadingFactor();

    class Mixer : public MixerAudioSource, public ChangeListener, public TimeSliceClient {
    public:
        Mixer(Medley& medley)
            : MixerAudioSource(), medley(medley)
        {

        }

        bool togglePause();

        void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

        inline bool isPaused() const { return paused; }

        inline void setPause(bool p) {
            paused = p;
        }

        void changeListenerCallback(ChangeBroadcaster* source) override;

        void updateAudioConfig();

        double getLevel(int channel) {
            ScopedLock sl(levelTrackerLock);
            return levelTracker.getLevel(channel);
        }

        double getPeak(int channel) {
            ScopedLock sl(levelTrackerLock);
            return levelTracker.getPeak(channel);
        }

        bool isClipping(int channel) {
            ScopedLock sl(levelTrackerLock);
            return levelTracker.isClipping(channel);
        }

        int useTimeSlice() override;

    private:
        Medley& medley;

        bool prepared = false;
        int numChannels = 2;
        bool paused = false;
        bool stalled = false;
        bool outputStarted = false;

        PostProcessor processor;
        LevelTracker levelTracker;
        CriticalSection levelTrackerLock;
    };

    friend class Mixer;

    AudioDeviceManager deviceMgr;
    AudioFormatManager formatMgr;

    Deck* deck1 = nullptr;
    Deck* deck2 = nullptr;
    Mixer mixer;
    AudioSourcePlayer mainOut;

    IQueue& queue;

    TimeSliceThread loadingThread;
    TimeSliceThread readAheadThread;
    TimeSliceThread visualizingThread;

    bool keepPlaying = false;

    enum class TransitionState {
        Idle,
        Cueing,
        Cued,
        Transit
    };

    TransitionState transitionState = TransitionState::Idle;
    Deck* transitingDeck = nullptr;

    std::list<Deck*> deckQueue;

    double fadingCurve = 60;
    float fadingFactor;

    double maxLeadingDuration = 2.5;
    double maxTransitionTime = 3.0;

    int forceFadingOut = 0;

    CriticalSection callbackLock;
    ListenerList<Callback> listeners;
};

}