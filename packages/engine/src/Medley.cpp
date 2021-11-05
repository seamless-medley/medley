#include "Medley.h"
#include "MiniMP3AudioFormat.h"
#include "NullAudioDevice.h"
#include "utils.h"

#if JUCE_WINDOWS
#include <Windows.h>
#endif

namespace medley {

Medley::Medley(IQueue& queue)
    :
    mixer(*this),
    faderIn(1.0f),
    faderOut(1.0f),
    queue(queue),
    loadingThread("Loading Thread"),
    readAheadThread("Read-ahead-thread"),
    visualizingThread("Visualizing Thread")
{
#if JUCE_WINDOWS
    static_cast<void>(::CoInitialize(nullptr));
#endif
    updateFadingFactor();

    auto error = deviceMgr.initialiseWithDefaultDevices(0, 2);
    if (error.isNotEmpty()) {
        throw std::runtime_error(error.toStdString());
    }

    deviceMgr.addAudioDeviceType(std::make_unique<NullAudioDeviceType>());

    mixer.updateAudioConfig();

    deviceMgr.addChangeListener(&mixer);

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

    for (int i = 0; i < numDecks; i++) {
        decks[i] = new Deck(i, "Deck " + String(i), formatMgr, loadingThread, readAheadThread);
        decks[i]->addListener(this);
        mixer.addInputSource(decks[i], false);
    }

    loadingThread.startThread(6);
    readAheadThread.startThread(9);
    visualizingThread.startThread();

    visualizingThread.addTimeSliceClient(&mixer);

    mainOut.setSource(&mixer);
    deviceMgr.addAudioCallback(&mainOut);
    deviceMgr.addChangeListener(this);

    if (auto device = deviceMgr.getCurrentAudioDevice()) {
        if (!device->isOpen()) {
            throw std::runtime_error("Audio device is not open");
        }

        if (!device->isPlaying()) {
            throw std::runtime_error("Audio device is not playing");
        }
    }

    setMaximumFadeOutDuration(3.0);
}

Medley::~Medley() {
    for (auto deck : decks) {
        deck->removeListener(this);
    }
    //
    mixer.removeAllInputs();
    mainOut.setSource(nullptr);

    loadingThread.stopThread(100);
    readAheadThread.stopThread(100);
    visualizingThread.stopThread(100);

    deviceMgr.closeAudioDevice();

    for (auto deck : decks) {
        delete deck;
    }
}

bool Medley::togglePause() {
    return !mixer.togglePause();
}

void Medley::setPosition(double time) {
    if (auto deck = getMainDeck()) {
        deck->setPosition(time);
        updateTransition(deck);
    }
}

void Medley::setPositionFractional(double fraction)
{
    if (auto deck = getMainDeck()) {
        deck->setPositionFractional(fraction);
        updateTransition(deck);
    }
}

void Medley::updateTransition(Deck* deck) {
    auto pState = &decksTransitionState[deck->index];

    if (*pState == DeckTransitionState::TransitToNext) {
        deck->log("Update Transition");

        auto position = deck->getPosition();
        auto transitionStartPos = deck->getTransitionStartPosition();

        auto nextDeck = getNextDeck(deck);
        if (nextDeck->isTrackLoaded()) {
            auto first = nextDeck->getFirstAudiblePosition();
            auto leadingDuration = nextDeck->getLeadingDuration();

            auto nextDeckStart = transitionStartPos - leadingDuration;
            auto nextDeckPosition = jmax(position - nextDeckStart + first, first);
            nextDeck->setPosition(nextDeckPosition);

            if (position < nextDeckStart) {
                nextDeck->internalPause();
                nextDeck->setVolume(1.0f);
                *pState = DeckTransitionState::NextIsReady;
            }
        }
    }
}

void Medley::interceptAudio(const AudioSourceChannelInfo& info)
{
    ScopedLock sl(audioCallbackLock);

    if (!audioCallback) return;

    audioCallback->audioData(info);
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
        return deck->getPosition();
    }

    return 0.0;
}

void Medley::setMaximumFadeOutDuration(double value) {
    maximumFadeOutDuration = value;
    for (auto deck : decks) {
        deck->setMaximumFadeOutDuration(value);
    }
}

void Medley::fadeOutMainDeck()
{
    if (auto deck = getMainDeck()) {
        forceFadingOut++;

        if (deck != nullptr && deck == transitingFromDeck && deck->isFading()) {
            transitingFromDeck->unloadTrack();
            deck = getNextDeck(deck);
        }

        if (deck) {
            deck->fadeOut(forceFadingOut >= 2 || queue.count() == 0);
            faderOut.start(deck->getTransitionStartPosition(), deck->getTransitionEndPosition(), deck->getVolume(), 0.0f, fadingFactor, 0.0f);
            mixer.setPause(false, false);
        }
    }
}

void Medley::changeListenerCallback(ChangeBroadcaster* source)
{
    if (auto deviceMgr = dynamic_cast<AudioDeviceManager*>(source)) {
        ScopedLock sl(callbackLock);

        listeners.call([](Callback& cb) {
            cb.audioDeviceChanged();
        });
    }
}

void Medley::loadNextTrack(Deck* currentDeck, bool play, Deck::OnLoadingDone onLoadingDone) {
    auto nextDeck = getNextDeck(currentDeck);

    if (nextDeck == nullptr) {
        currentDeck->log("Could not find another deck");
        return;
    }

    if (nextDeck->isTrackLoading) {
        nextDeck->log("is busy loading some track");
        nextDeck->unloadTrack();
    }

    auto const pQueue = &queue;
    Deck::OnLoadingDone deckLoadingHandler = [&, _onLoadingDone = onLoadingDone, p = play, _pQueue = pQueue, _nextDeck = nextDeck](bool loadingResult) {
        if (loadingResult) {
            _onLoadingDone(true);

            if (p) {
                _nextDeck->start();
            }

            return;
        }

        // Fetch next track from queue
        if (_pQueue->count() > 0) {
            auto track = _pQueue->fetchNextTrack();
            _nextDeck->loadTrack(track, deckLoadingHandler);
            return;
        }

        {
            // Queue is empty, request to fill it with some tracks
            ScopedLock sl(callbackLock);
            listeners.call([&](Callback& listener) {
                listener.preQueueNext([&, _pQueue = pQueue, cd = currentDeck, p = play, _onLoadingDone = onLoadingDone](bool preQueueResult) {
                    if (preQueueResult && _pQueue->count() > 0) {
                        // preQueue succeeded, try to load again
                        loadNextTrack(cd, p, _onLoadingDone);
                    }
                    else {
                        _onLoadingDone(false);
                    }
                });
            });
        }
    };

    // Fetch next track from queue
    if (queue.count() > 0) {
        auto track = queue.fetchNextTrack();
        if (track) {
            nextDeck->loadTrack(track, deckLoadingHandler);
            return;
        }
    }

    // Queue is empty, request to fill it with some tracks
    {
        ScopedLock sl(callbackLock);
        listeners.call([&](Callback& listener) {
            listener.preQueueNext([&, _pQueue = pQueue, cd = currentDeck, p = play, _onLoadingDone = onLoadingDone](bool preQueueResult) {
                if (preQueueResult && _pQueue->count() > 0) {
                    // preQueue succeeded, try to load again
                    loadNextTrack(cd, p, _onLoadingDone);
                }
                else {
                    _onLoadingDone(false);
                }
            });
        });
    }
}

void Medley::deckTrackScanning(Deck& sender)
{

}

void Medley::deckTrackScanned(Deck& sender)
{

}

Deck* Medley::getAvailableDeck() {
    for (auto deck : decks) {
        if (!deck->isTrackLoaded()) {
            return deck;
        }
    }

    return nullptr;
}

Deck* Medley::getNextDeck(Deck* from) {
    if (from == nullptr) {
        from = getMainDeck();
    }

    if (from == nullptr) {
        auto next = getAvailableDeck();
        return (next != nullptr) ? next : decks[0];
    }

    return decks[(from->index + 1) % numDecks];
}

Deck* Medley::getPreviousDeck(Deck* from)
{
    if (from == nullptr) {
        from = getMainDeck();
    }

    if (from == decks[0]) {
        return decks[2];
    }

    if (from == decks[1]) {
        return decks[0];
    }

    if (from == decks[2]) {
        return decks[1];
    }

    return decks[2];
}

inline String Medley::getDeckName(Deck& deck) {
    return deck.getName();
}

void Medley::deckStarted(Deck& sender, ITrack::Ptr& track) {
    sender.log("Started");

    auto prevDeck = getPreviousDeck(&sender);
    if (decksTransitionState[prevDeck->index] == DeckTransitionState::Idle) {
        sender.markAsMain(true);
    }

    ScopedLock sl(callbackLock);
    listeners.call([&](Callback& cb) {
        cb.deckStarted(sender, track);
    });
}

void Medley::deckFinished(Deck& sender, ITrack::Ptr& track) {
    ScopedLock sl(callbackLock);
    listeners.call([&](Callback& cb) {
        cb.deckFinished(sender, track);
    });
}

void Medley::deckLoaded(Deck& sender, ITrack::Ptr& track)
{
    ScopedLock sl(callbackLock);
    listeners.call([&](Callback& cb) {
        cb.deckLoaded(sender, track);
    });
}

void Medley::deckUnloaded(Deck& sender, ITrack::Ptr& track) {
    sender.log("Unloaded");

    auto nextDeck = getNextDeck(&sender);

    if (&sender == transitingFromDeck) {
        faderOut.reset();

        if (nextDeck->isTrackLoaded() && !nextDeck->isPlaying()) {
            sender.log("Stopped before transition would happen, try starting next deck");
            nextDeck->start();
        }
    }

    decksTransitionState[sender.index] = DeckTransitionState::Idle;
    transitingFromDeck = nullptr;
    nextDeck->setVolume(1.0f);

    if (forceFadingOut > 0) {
        forceFadingOut--;
    }

    sender.markAsMain(false);
    nextDeck->markAsMain(nextDeck->isTrackLoaded());

    {
        ScopedLock sl(callbackLock);

        listeners.call([&](Callback& cb) {
            cb.deckUnloaded(sender, track);
        });
    }

    // Just in case
    if (keepPlaying && !isDeckPlaying()) {
        auto shouldContinuePlaying = (nextDeck->getTrack() != nullptr) || (queue.count() > 0);
        keepPlaying = shouldContinuePlaying;

        if (shouldContinuePlaying) {
            auto deck = &sender;
            for (int i = 0; i < numDecks; i++) {
                auto next = getNextDeck(deck);

                if (next->isTrackLoaded()) {
                    next->start();
                    return;
                }

                deck = next;
            }

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

    auto nextDeck = getNextDeck(&sender);
    if (nextDeck == nullptr) {
        return;
    }

    auto preQueuePoint = sender.getTransitionPreCuePosition();
    auto cuePoint = sender.getTransitionCuePosition();
    auto transitionStartPos = sender.getTransitionStartPosition();
    auto transitionEndPos = sender.getTransitionEndPosition();

    auto pState = &decksTransitionState[sender.index];

    if (*pState < DeckTransitionState::NextIsReady) {
        // Idle, CueNext, NextIsLoading

        if (*pState == DeckTransitionState::Idle) {
            // Idle

            if (position > preQueuePoint) {
                // We're passing the queue point while idling, call preQueueNext to ensure that there is enough track enqueued
                *pState = DeckTransitionState::CueNext;

                if (queue.count() == 0)
                {
                    ScopedLock sl(callbackLock);

                    listeners.call([](Callback& cb) {
                        cb.preQueueNext();
                    });
                }
            }
        }

        if (*pState <= DeckTransitionState::CueNext) {
            // Idle, CueNext

            if (position > cuePoint) {
                *pState = DeckTransitionState::NextIsLoading;

                auto currentDeck = &sender;
                loadNextTrack(currentDeck, false, [&, _pState = pState, _position = position, tsp = transitionStartPos, tep = transitionEndPos, cd = currentDeck, nd = nextDeck](bool loaded) {
                    if (loaded) {
                        *_pState = DeckTransitionState::NextIsReady;
                        transitingFromDeck = cd;

                        if (forceFadingOut > 0) {
                            faderIn.start(_position, tep, 0.0f, 1.0f, fadingFactor * 0.5f);
                        }
                        else {
                            auto leadIn = nd->getLeadingDuration();
                            auto fadeInStart = jmax(0.0, tsp - leadIn);
                            faderIn.start(fadeInStart, fadeInStart + leadIn, 0.25f, 1.0f, fadingFactor);
                        }
                    }
                    else {
                        *_pState = DeckTransitionState::CueNext; // Move back to the previous state, this will cause a retry
                        transitingFromDeck = nullptr;

                        // No more track, do not transit
                        if (forceFadingOut <= 0) {
                            return;
                        }
                    }

                    doTransition(cd, _position);
                });
            }
        }
    }

    doTransition(&sender, position);
}

void Medley::doTransition(Deck* deck, double position) {
    auto pState = &decksTransitionState[deck->index];

    if (*pState < DeckTransitionState::NextIsReady) {
        return;
    }

    auto nextDeck = getNextDeck(deck);    

    auto transitionStartPos = deck->getTransitionStartPosition();
    auto transitionEndPos = deck->getTransitionEndPosition();

    if (nextDeck->isTrackLoaded()) {
        auto lastAudible = deck->getLastAudiblePosition();
        auto leadingDuration = nextDeck->getLeadingDuration();
        auto nextDeckStart = (transitionStartPos - leadingDuration) - 0.05 /* Correct clock drift caused by playhead timer */;

        if (nextDeckStart > lastAudible) {
            nextDeckStart = lastAudible - 0.01;
        }

        if (position > nextDeckStart) {
            if (*pState == DeckTransitionState::NextIsReady) {
                nextDeck->log("Transiting to this deck");

                *pState = DeckTransitionState::TransitToNext;
                nextDeck->setVolume(1.0f);
                nextDeck->setPosition(nextDeck->getFirstAudiblePosition());

                if (forceFadingOut > 0) {
                    if (leadingDuration >= minimumLeadingToFade) {
                        nextDeck->setPosition(nextDeck->getFirstAudiblePosition() + leadingDuration - minimumLeadingToFade);
                    }
                }
                else {
                    // Start too late
                    if (nextDeckStart < 0) {
                        // A negative nextDeckStart indicates that the transition is shorter than nextDecks's leadingDuration
                        // That is to say, it should have been started -nextDeckStart seconds ago
                        // So we try our best in trying to play the next track in sync.
                        auto nowPos = nextDeck->getFirstAudiblePosition() + (-nextDeckStart);
                        nextDeck->setPosition(nowPos);

                        faderIn.start(position, transitionEndPos, 0.25f, 1.0f, fadingFactor);
                    }
                }

                faderOut.start(transitionStartPos, transitionEndPos, 1.0f, 0.0f, fadingFactor);
                nextDeck->start();
            }

            // Fade in next
            auto newVolume = (leadingDuration > minimumLeadingToFade) ? faderIn.update(position) : 1.0f;
            if (newVolume != nextDeck->getVolume()) {
                //nextDeck->log(String::formatted("Fading in: %.2f", newVolume));
                nextDeck->setVolume(newVolume);
            }
        }

        // Fade out current
        auto currentVolume = deck->getVolume();
        auto newVolume = faderOut.update(position);
        if (newVolume != currentVolume) {
            //deck->log(String::formatted("Fading out: %.2f", newVolume));
            deck->setVolume(newVolume);
        }

        if (position >= transitionStartPos) {
            auto transitionDuration = (transitionEndPos - transitionStartPos);
            auto transitionProgress = jlimit(0.0, 1.0, (position - transitionStartPos) / transitionDuration);

            if (*pState != DeckTransitionState::Idle && position > transitionEndPos) {
                if (transitionProgress >= 1.0) {
                    forceFadingOut = 0;
                    deck->stop();
                }
            }
        }
    }
}

void Medley::setAudioDeviceByIndex(int index) {
    auto config = deviceMgr.getAudioDeviceSetup();
    config.outputDeviceName = getDeviceNames()[index];
    auto error = deviceMgr.setAudioDeviceSetup(config, true);
    if (error.isNotEmpty()) {
        throw std::runtime_error(error.toStdString());
    }
}

Deck* Medley::getMainDeck() const
{  
    for (auto deck : decks) {
        if (deck->isMain()) {
            return deck;
        }
    }

    return nullptr;
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
    mixer.setPause(false, mixer.isPaused());
}

void Medley::stop()
{
    mixer.fadeOut(400, [=]() {
        keepPlaying = false;

        for (auto deck : decks) {
            deck->stop();
            deck->unloadTrack();
        }
    });
}

bool Medley::isDeckPlaying()
{
    for (auto deck : decks) {
        if (deck->isPlaying()) {
            return true;
        }
    }

    return false;
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

void medley::Medley::setAudioCallback(AudioCallback* callback)
{
    ScopedLock sl(audioCallbackLock);
    audioCallback = callback;
}

void Medley::updateFadingFactor() {
    double outRange = 1000.0 - 1.0;
    double inRange = 100.0;

    fadingFactor = (float)(1000.0 / (((100.0 - fadingCurve) / inRange * outRange) + 1.0));
}

bool Medley::isTrackLoadable(const ITrack::Ptr track) {
    return utils::isTrackLoadable(formatMgr, track);
}

void Medley::Mixer::setPause(bool p, bool fade) {
    if (!fade) {
        paused = p;
        fader.reset(1.0f);
        return;
    }

    auto start = currentTime + 100;
    auto end = start + 400;

    if (p) {
        // do pause
        fader.start(start, end, gain, 0.0f, 2.0f, -1.0f, [=]() {
            paused = true;
        });
    }
    else {
        // unpause
        paused = false;
        fader.start(start, end, gain, 1.0f, 2.0f, -1.0f, [=]() {

        });
    }
}


bool Medley::Mixer::togglePause() {
    setPause(!paused);
    return !paused;
}

void Medley::Mixer::getNextAudioBlock(const AudioSourceChannelInfo& info) {
    currentTime = Time::getMillisecondCounterHiRes();

    if (!outputStarted) {
        outputStarted = true;
        Logger::writeToLog("Output started");
    }

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

    gain = volume * fader.update(currentTime);

    for (int i = info.buffer->getNumChannels(); --i >= 0;) {
        info.buffer->applyGainRamp(i, info.startSample, info.numSamples, lastGain, gain);
    }

    lastGain = gain;

    if (prepared) {
        AudioBlock<float> block(
            info.buffer->getArrayOfWritePointers(),
            info.buffer->getNumChannels(),
            (size_t)info.startSample,
            (size_t)info.numSamples
        );

        processor.process(ProcessContextReplacing<float>(block));

        medley.interceptAudio(info);

        {
            ScopedLock sl(levelTrackerLock);
            levelTracker.process(info);
        }
    }
}

void Medley::Mixer::changeListenerCallback(ChangeBroadcaster* source) {
    updateAudioConfig();
}

int Medley::Mixer::useTimeSlice()
{
    ScopedLock sl(levelTrackerLock);
    levelTracker.update();
    return 5;
}

void medley::Medley::Mixer::fadeOut(double durationMs, Fader::OnDone callback)
{
    fader.start(currentTime, currentTime + durationMs, gain, 0.0f, 2.0f, -1.0f, callback);
}

void Medley::Mixer::updateAudioConfig()
{
    auto& deviceMgr = medley.deviceMgr;
    if (auto device = deviceMgr.getCurrentAudioDevice()) {
        auto config = deviceMgr.getAudioDeviceSetup();

        int latencyInSamples = device->getOutputLatencyInSamples();

#ifdef JUCE_WINDOWS
        if (device->getTypeName() == "DirectSound") {
            latencyInSamples *= 16;
        }
#endif

        auto numSamples = device->getCurrentBufferSizeSamples();
        numChannels = device->getOutputChannelNames().size();
        sampleRate = (int)config.sampleRate;

        processor.prepare({ config.sampleRate, (uint32)numSamples, (uint32)numChannels });

        levelTracker.prepare(
            numChannels,
            sampleRate,
            latencyInSamples
        );

        prepared = true;
    }
}

}
