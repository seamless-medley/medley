#pragma once

#include <JuceHeader.h>

#include "Deck.h"

using namespace juce;

namespace medley {

class ITrack : public ReferenceCountedObject {
public:
    virtual String getFullPath() const = 0;
    // TODO: ReplayGain

    using Ptr = ReferenceCountedObjectPtr<ITrack>;
};

class ITrackMetadata {

};

class IQueue {
public:
    virtual size_t count() const = 0;
    virtual ITrack::Ptr fetchNextTrack() = 0;
};

class Medley : public Deck::Callback {
public:

    Medley(IQueue& queue);

    ~Medley();

    bool loadNextTrack(Deck* currentDeck, bool play);

    Deck& getDeck1() const { return *deck1; }

    Deck& getDeck2() const { return *deck2; }

    double getFadingCurve() const { return fadingCurve; }

    void setFadingCurve(double curve);

    // TODO: Transition time

private:

    void deckStarted(Deck& sender) override;

    void deckFinished(Deck& sender) override;

    void deckUnloaded(Deck& sender) override;

    void deckPosition(Deck& sender, double position) override;

    Deck* getAvailableDeck();

    Deck* getAnotherDeck(Deck* from);

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

    IQueue& queue;

    enum class TransitionState {
        Idle,
        Cue,
        Transit
    };

    TransitionState transitionState = TransitionState::Idle;
    Deck* transitingDeck = nullptr;

    double fadingCurve = 60;
    float fadingFactor;
};

}