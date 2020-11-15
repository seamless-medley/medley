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

    Deck& getDeck1() const { return *deck1; }

    Deck& getDeck2() const { return *deck2; }

    Deck* getActiveDeck() const;

    Deck* getAnotherDeck(Deck* from);

    double getFadingCurve() const { return fadingCurve; }

    void setFadingCurve(double curve);

    void play();

    bool isDeckPlaying();

    void addListener(Callback* cb);

    void removeListener(Callback* cb);

    // TODO: Transition time

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

    AudioDeviceManager deviceMgr;
    AudioFormatManager formatMgr;
    Deck* deck1 = nullptr;
    Deck* deck2 = nullptr;
    MixerAudioSource mixer;
    AudioSourcePlayer mainOut;

    TimeSliceThread loadingThread;
    TimeSliceThread readAheadThread;

    bool playing = false;
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

    double longLeadingTrackDuration = 2.0;

    CriticalSection callbackLock;
    ListenerList<Callback> listeners;
};

}