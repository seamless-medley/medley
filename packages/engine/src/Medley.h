#pragma once

#include <JuceHeader.h>

#include "Deck.h"
#include <list>

using namespace juce;

namespace medley {


class IQueue {
public:
    virtual size_t count() const = 0;
    virtual ITrack::Ptr fetchNextTrack() = 0;
};

class Medley : public Deck::Callback {
public:

    class Callback : public Deck::Callback {

    };

    Medley(IQueue& queue);

    ~Medley();

    inline const auto& getAvailableDeviceTypes() {
        return deviceMgr.getAvailableDeviceTypes();
    }    

    inline void setCurrentAudioDeviceType(AudioIODeviceType& type) {
        deviceMgr.setCurrentAudioDeviceType(type.getTypeName(), true);
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

    inline void setAudioDeviceByIndex(int index) {
        auto config = deviceMgr.getAudioDeviceSetup();
        config.outputDeviceName = getDeviceNames()[index];
        deviceMgr.setAudioDeviceSetup(config, true);
    }

    inline const AudioFormatManager& getAudioFormatManager() const { return formatMgr; }

    inline Deck& getDeck1() const { return *deck1; }

    inline Deck& getDeck2() const { return *deck2; }

    Deck* getMainDeck() const;

    Deck* getAnotherDeck(Deck* from);

    double getFadingCurve() const { return fadingCurve; }

    void setFadingCurve(double curve);

    void play();

    void stop();

    bool isDeckPlaying();

    void addListener(Callback* cb);

    void removeListener(Callback* cb);

    inline void setGain(float newGain) { mainOut.setGain(newGain); }

    inline float getGain() const { return mainOut.getGain(); }

    inline bool togglePause() { return mixer.togglePause(); }

    inline bool isPaused() const { return mixer.isPaused(); }

    void setPositionFractional(double fraction);

    double getDuration() const;

    double getPositionInSeconds() const;

    double getMaxLeadingDuration() const { return maxLeadingDuration; }

    void setMaxLeadingDuration(double value) {
        maxLeadingDuration = value;
    }

    double getMaxTransitionTime() const { return maxTransitionTime; }

    void setMaxTransitionTime(double value);

    void fadeOutMainDeck();

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

    String getDeckName(Deck& deck);

    void updateFadingFactor();

    class Mixer : public MixerAudioSource {
    public:
        bool togglePause();

        void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

        bool isPaused() const { return paused; }

        void setPause(bool p) {
            paused = p;
        }

    private:
        bool paused = false;
        bool stalled = false;
    };

    AudioDeviceManager deviceMgr;
    AudioFormatManager formatMgr;
    Deck* deck1 = nullptr;
    Deck* deck2 = nullptr;
    Mixer mixer;
    AudioSourcePlayer mainOut;

    TimeSliceThread loadingThread;
    TimeSliceThread readAheadThread;

    bool keepPlaying = false;
    IQueue& queue;

    enum class TransitionState {
        Idle,
        Cue,
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