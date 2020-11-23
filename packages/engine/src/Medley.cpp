#include "Medley.h"
#include "MiniMP3AudioFormat.h"

namespace medley {

Medley::Medley(IQueue& queue)
    :
    queue(queue),
    loadingThread("Loading Thread"),
    readAheadThread("Read-ahead-thread")
{
    updateFadingFactor();

    deviceMgr.initialise(0, 2, nullptr, true, {}, nullptr);

    formatMgr.registerFormat(new MiniMP3AudioFormat(), true);
    formatMgr.registerFormat(new WavAudioFormat(), false);
    formatMgr.registerFormat(new AiffAudioFormat(), false);
    formatMgr.registerFormat(new FlacAudioFormat(), false);
    formatMgr.registerFormat(new OggVorbisAudioFormat(), false);

#if JUCE_MAC || JUCE_IOS
    formatMgr.registerFormat(new CoreAudioFormat(), false);
#endif

#if JUCE_USE_WINDOWS_MEDIA_FORMAT
    formatMgr.registerFormat(new WindowsMediaAudioFormat(), false);
#endif    

    deck1 = new Deck("Deck A", formatMgr, loadingThread, readAheadThread);
    deck2 = new Deck("Deck B", formatMgr, loadingThread, readAheadThread);

    deck1->addListener(this);
    deck2->addListener(this);

    loadingThread.startThread();
    readAheadThread.startThread(8);

    mixer.addInputSource(deck1, false);
    mixer.addInputSource(deck2, false);

    mainOut.setSource(&mixer);
    deviceMgr.addAudioCallback(&mainOut);
}

Medley::~Medley() {
    deck1->removeListener(this);
    deck2->removeListener(this);
    //
    mixer.removeAllInputs();
    mainOut.setSource(nullptr);

    loadingThread.stopThread(100);
    readAheadThread.stopThread(100);

    deviceMgr.closeAudioDevice();

    delete deck1;
    delete deck2;
}

void Medley::setPositionFractional(double fraction)
{
    if (auto deck = getMainDeck()) {
        deck->setPositionFractional(fraction);
    }
}

double Medley::getDuration() const
{
    if (auto deck = getMainDeck()) {
        return deck->getDuration();
    }

    return 0.0;
}

double Medley::getPositionInSeconds() const
{
    if (auto deck = getMainDeck()) {
        return deck->getPositionInSeconds();
    }

    return 0.0;
}

void Medley::setMaxTransitionTime(double value) {
    maxTransitionTime = value;
    deck1->setMaxTransitionTime(value);
    deck2->setMaxTransitionTime(value);
}

void Medley::fadeOutMainDeck()
{
    if (auto deck = getMainDeck()) {
        forceFadingOut = true;

        if (transitionState == TransitionState::Transit) {
            deck->unloadTrack();
            transitionState = TransitionState::Idle;

            deck = getMainDeck();
        }

        if (deck) {
            deck->fadeOut();
        }        
    }
}

bool Medley::loadNextTrack(Deck* currentDeck, bool play) {
    auto deck = getAnotherDeck(currentDeck);

    if (deck == nullptr) {
        DBG("Could not find another deck for " + getDeckName(*currentDeck));
        return false;
    }

    while (queue.count() > 0) {
        auto track = queue.fetchNextTrack();
        if (deck->loadTrack(track, play)) {
            return true;
        }
    }

    return false;
}

void Medley::deckTrackScanning(Deck& sender)
{

}

void Medley::deckTrackScanned(Deck& sender)
{

}

Deck* Medley::getAvailableDeck() {
    return !deck1->isTrackLoaded() ? deck1 : (!deck2->isTrackLoaded() ? deck2 : nullptr);
}

Deck* Medley::getAnotherDeck(Deck* from) {
    if (from == nullptr) {
        return getAvailableDeck();
    }

    return (from == deck1) ? deck2 : deck1;
}

inline String Medley::getDeckName(Deck& deck) {
    return deck.getName();
}

void Medley::deckStarted(Deck& sender) {
    DBG(String::formatted("[deckStarted] %s", sender.getName().toWideCharPointer()));

    ScopedLock sl(callbackLock);
    listeners.call([&sender](Callback& cb) {
        cb.deckStarted(sender);
    });
}

void Medley::deckFinished(Deck& sender) {
    ScopedLock sl(callbackLock);
    listeners.call([&sender](Callback& cb) {
        cb.deckFinished(sender);
    });
}

void Medley::deckLoaded(Deck& sender)
{
    {
        ScopedLock sl(callbackLock);

        deckQueue.push_back(&sender);
        deckQueue.front()->markAsMain(true);

        listeners.call([&](Callback& cb) {
            cb.deckLoaded(sender);
        });
    }
}

void Medley::deckUnloaded(Deck& sender) {
    if (&sender == transitingDeck) {
        if (transitionState == TransitionState::Cue) {
            DBG(String::formatted("[%s] stopped before transition would happen, try starting next deck", sender.getName().toWideCharPointer()));
            auto nextDeck = getAnotherDeck(transitingDeck);
            if (nextDeck->isTrackLoaded()) {
                nextDeck->start();
            }
        }

        transitionState = TransitionState::Idle;
        transitingDeck = nullptr;
        forceFadingOut = false;
    }

    {
        ScopedLock sl(callbackLock);

        sender.markAsMain(false);
        deckQueue.remove(&sender);

        if (!deckQueue.empty()) {
            deckQueue.front()->markAsMain(true);
        }

        listeners.call([&](Callback& cb) {
            cb.deckUnloaded(sender);
        });
    }

    // Just in case
    if (keepPlaying && !isDeckPlaying()) {
        auto shouldContinuePlaying = queue.count() > 0;
        keepPlaying = shouldContinuePlaying;

        if (shouldContinuePlaying) {
            loadNextTrack(nullptr, true);
        }
    }
}

void Medley::deckPosition(Deck& sender, double position) {
    {
        ScopedLock sl(callbackLock);
        listeners.call([&](Callback& cb) {
            cb.deckPosition(sender, position);
        });
    }

    auto nextDeck = getAnotherDeck(&sender);
    if (nextDeck == nullptr) {
        return;
    }

    auto transitionCuePoint = sender.getTransitionCuePosition();
    auto transitionStartPos = sender.getTransitionStartPosition();
    auto transitionEndPos = sender.getTransitionEndPosition();
    auto trailingDuration = sender.getTrailingDuration();

    auto leadingDuration = nextDeck->getLeadingDuration();

    if (transitionState == TransitionState::Idle) {
        if (position > transitionCuePoint) {
            if (!loadNextTrack(&sender, false)) {
                // No more track, do not transit
                if (!forceFadingOut) {
                    return;
                }
            }

            DBG(String::formatted("[%s] cue", nextDeck->getName().toWideCharPointer()));
            transitionState = TransitionState::Cue;
            transitingDeck = &sender;
        }
    }

    if (position > transitionStartPos - leadingDuration) {
        if (transitionState != TransitionState::Transit) {
            if (nextDeck->isTrackLoaded()) {
                DBG(String::formatted("Transiting to [%s]", nextDeck->getName().toWideCharPointer()));
                transitionState = TransitionState::Transit;                
                nextDeck->setVolume(1.0f);
                nextDeck->start();
            }
        }

        if (transitionState == TransitionState::Transit) {
            if (leadingDuration >= maxLeadingDuration) {
                auto fadeInProgress = jlimit(0.25, 1.0, (position - (transitionStartPos - leadingDuration)) / leadingDuration);

                DBG(String::formatted("[%s] Fading in: %.2f", nextDeck->getName().toWideCharPointer(), fadeInProgress));
                nextDeck->setVolume((float)pow(fadeInProgress, fadingFactor));
            }
        }
    }

    if (sender.isMain()) {
        if (position >= transitionStartPos) {
            auto transitionDuration = (transitionEndPos - transitionStartPos);
            auto transitionProgress = jlimit(0.0, 1.0, (position - transitionStartPos) / transitionDuration);

            auto fadingDuration = jmax(0.0, forceFadingOut ? transitionDuration : trailingDuration - transitionDuration);

            if (fadingDuration > 0.0) {
                auto fadingStart = forceFadingOut ? transitionStartPos : transitionEndPos - fadingDuration;

                if (position >= fadingStart) {
                    auto fadingProgress = jlimit(0.0, 1.0, (position - fadingStart) / fadingDuration);

                    DBG(String::formatted("[%s] Fading out: %.2f", sender.getName().toWideCharPointer(), fadingProgress));
                    sender.setVolume((float)pow(1.0f - fadingProgress, fadingFactor));
                }
            }

            if (transitionState != TransitionState::Idle && position > transitionEndPos) {
                if (transitionProgress >= 1.0) {
                    sender.unloadTrack();
                }
            }
        }
    }
}

Deck* Medley::getMainDeck() const
{
    return deckQueue.empty() ? nullptr : deckQueue.front();
}

void Medley::setFadingCurve(double curve) {
    fadingCurve = jlimit(0.0, 100.0, curve);
    updateFadingFactor();
}

void Medley::play()
{
    if (!isDeckPlaying()) {
        loadNextTrack(nullptr, true);
    }

    keepPlaying = true;
}

void Medley::stop()
{
    keepPlaying = false;

    deck1->stop();
    deck2->stop();

    deck1->unloadTrack();
    deck2->unloadTrack();    
}

bool Medley::isDeckPlaying()
{
    return deck1->isPlaying() || deck2->isPlaying();
}

void Medley::addListener(Callback* cb)
{
    ScopedLock sl(callbackLock);
    listeners.add(cb);
}

void Medley::removeListener(Callback* cb)
{
    ScopedLock sl(callbackLock);
    listeners.remove(cb);
}

void Medley::updateFadingFactor() {
    double outRange = 1000.0 - 1.0;
    double inRange = 100.0;
    fadingFactor = (float)(1000.0 / (((100.0 - fadingCurve) / inRange * outRange) + 1.0));
}

bool Medley::Mixer::togglePause() {
    return paused = !paused;
}

void Medley::Mixer::getNextAudioBlock(const AudioSourceChannelInfo& info) {
    if (!stalled) {
        MixerAudioSource::getNextAudioBlock(info);

        if (paused) {
            for (int i = info.buffer->getNumChannels(); --i >= 0;) {
                info.buffer->applyGainRamp(i, info.startSample, jmin(256, info.numSamples), 1.0f, 0.0f);
            }

            stalled = true;
        }
    }
    else /* stalled */ {
        if (!paused) {
            MixerAudioSource::getNextAudioBlock(info);

            for (int i = info.buffer->getNumChannels(); --i >= 0;) {
                info.buffer->applyGainRamp(i, info.startSample, jmin(256, info.numSamples), 0.0f, 1.0f);
            }

            stalled = false;
        }
    }
}

}
