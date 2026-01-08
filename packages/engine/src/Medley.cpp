#include "Medley.h"
#include "MiniMP3AudioFormat.h"
#include "OpusAudioFormat.h"
#include "NullAudioDevice.h"
#include "utils.h"

#if JUCE_WINDOWS
#include <Windows.h>
#endif

namespace medley {

Medley::Medley(IQueue& queue, ILoggerWriter* logWriter, bool skipDeviceScanning)
    :
    audioInterceptor(*this),
    mixer(*this),
    watchdog(*this),
    queue(queue),
    loadingThread("Loading Thread"),
    readAheadThread("Read-ahead-thread"),
    visualizationThread("Visualization Thread"),
    audioInterceptionThread("Audio interception thread")
{
#if JUCE_WINDOWS
    static_cast<void>(::CoInitialize(nullptr));
#endif
    logger = std::make_unique<medley::Logger>("medley", logWriter);

    updateFadingFactor();

    juce::String error;

    if (!skipDeviceScanning) {
        error = deviceMgr.initialiseWithDefaultDevices(0, 2);
    }

    deviceMgr.addAudioDeviceType(std::make_unique<NullAudioDeviceType>());

    if (skipDeviceScanning || error.isNotEmpty() || getCurrentAudioDevice() == nullptr) {
        setCurrentAudioDeviceType("Null");
        setAudioDeviceByIndex(0);
    }

    mixer.updateAudioConfig();

    deviceMgr.addChangeListener(&mixer);

    for (int i = 0; i < numDecks; i++) {
        decks[i].reset(new Deck(i, "Deck " + String(i), logWriter, formatMgr, loadingThread, readAheadThread));
        decks[i]->addListener(this);
        mixer.addInputSource(decks[i].get(), false);
    }

    loadingThread.startThread(6);
    readAheadThread.startThread(9);
    visualizationThread.startThread();
    audioInterceptionThread.startThread(9);

    loadingThread.addTimeSliceClient(&watchdog);
    visualizationThread.addTimeSliceClient(&mixer);
    audioInterceptionThread.addTimeSliceClient(&audioInterceptor);

    mainOut.setSource(&mixer);
    deviceMgr.addAudioCallback(&mainOut);
    deviceMgr.addChangeListener(this);

    if (auto device = deviceMgr.getCurrentAudioDevice()) {
        if (!device->isOpen()) {
            throw std::runtime_error(("Audio device is not open, type=" + device->getTypeName() + ", name=" + device->getName()).toStdString());
        }
    }

    setMaximumFadeOutDuration(3.0);
}

Medley::~Medley() {
    for (auto& deck : decks) {
        deck->removeListener(this);
    }

    mixer.removeAllInputs();
    mainOut.setSource(nullptr);

    loadingThread.stopThread(100);
    readAheadThread.stopThread(100);
    visualizationThread.stopThread(100);

    deviceMgr.closeAudioDevice();

    // Decks are automatically deleted by unique_ptr
}

Medley::SupportedFormats::SupportedFormats()
    : AudioFormatManager()
{
    registerFormat(new MiniMP3AudioFormat(), true);
    registerFormat(new WavAudioFormat(), false);
    registerFormat(new AiffAudioFormat(), false);
    registerFormat(new FlacAudioFormat(), false);
    registerFormat(new OggVorbisAudioFormat(), false);
    registerFormat(new OpusAudioFormat(), false);

#if JUCE_MAC || JUCE_IOS
    registerFormat(new CoreAudioFormat(), false);
#endif

#if JUCE_USE_WINDOWS_MEDIA_FORMAT
    registerFormat(new WindowsMediaAudioFormat(), false);
#endif
}

bool Medley::togglePause(bool fade) {
    return !mixer.togglePause(fade);
}

void Medley::setPosition(double time, int deckIndex) {
    if (auto deck = getDeck(deckIndex)) {
        deck->setPosition(time);
        updateTransition(deck);
    }
}

void Medley::setPositionFractional(double fraction, int deckIndex)
{
    if (auto deck = getDeck(deckIndex)) {
        deck->setPositionFractional(fraction);
        updateTransition(deck);
    }
}

void Medley::updateTransition(Deck* deck) {
    auto d = deck;

    for (int i = 0; i < numDecks - 1; i++) {
        auto pState = &decksTransition[d->index].state;

        if (*pState == DeckTransitionState::TransitToNext) {
            d->log(LogLevel::Debug, "Update Transition");

            auto position = d->getPosition();
            auto transitionStartPos = d->getTransitionStartPosition();

            auto nextDeck = getNextDeck(d);
            if (nextDeck->isTrackLoaded()) {
                auto first = nextDeck->getFirstAudiblePosition();
                auto leadingDuration = !d->disableNextTrackLeadIn ? nextDeck->getLeadingDuration() : 0.0;

                auto nextDeckStart = transitionStartPos - leadingDuration;
                auto nextDeckPosition = jmax(position - nextDeckStart + first, first);
                nextDeck->setPosition(nextDeckPosition);

                if (position < nextDeckStart) {
                    nextDeck->internalPause();
                    nextDeck->setVolume(decksTransition[nextDeck->index].fader.getFrom());
                    *pState = DeckTransitionState::NextIsReady;
                }
            }

            d = nextDeck;
        }
    }
}

void Medley::dispatchAudio(const AudioSourceChannelInfo& info, double timestamp)
{
    ScopedLock sl(audioCallbackLock);

    if (!audioCallback) return;

    audioCallback->audioData(info, timestamp);
}

bool Medley::isKaraokeEnabled() const
{
    return mixer.processor.isKaraokeEnabled();
}

bool Medley::setKaraokeEnabled(bool enabled, bool dontTransit)
{
    return mixer.processor.setKaraokeEnabled(enabled, dontTransit);
}

float Medley::getKaraokeParams(DeFXKaraoke::Param param) const
{
    return mixer.processor.getKaraokeParams(param);
}

float Medley::setKaraokeParams(DeFXKaraoke::Param param, float newValue)
{
    return mixer.processor.setKaraokeParams(param, newValue);
}

double Medley::getDuration(int deckIndex) const
{
    if (auto deck = getDeck(deckIndex)) {
        return deck->getDuration();
    }

    return 0.0;
}

double Medley::getPositionInSeconds(int deckIndex) const
{
    if (auto deck = getDeck(deckIndex)) {
        return deck->getPosition();
    }

    return 0.0;
}

void Medley::setMaximumFadeOutDuration(double value) {
    maximumFadeOutDuration = value;
    for (auto& deck : decks) {
        deck->setMaximumFadeOutDuration(value);
    }
}

bool Medley::fadeOutMainDeck()
{
    if (auto deck = getMainDeck()) {
        forceFadingOut++;

        if (deck != nullptr && deck == transitingFromDeck.load() && deck->isFadingOut()) {
            auto fromDeck = transitingFromDeck.load();
            if (fromDeck) {
                fromDeck->unloadTrack();
            }

            deck = getNextDeck(deck);
        }

        if (deck) {
            deck->fadeOut(forceFadingOut.load() >= 2 || queue.count() == 0);
            decksTransition[deck->index].fader.start(deck->getTransitionStartPosition(), deck->getTransitionEndPosition() + 0.05, deck->getVolume(), 0.0f, fadingFactor, 0.0f);
            mixer.setPause(false, false);
        }

        return deck != nullptr;
    }

    return false;
}

void Medley::changeListenerCallback(ChangeBroadcaster* source)
{
    if (dynamic_cast<AudioDeviceManager*>(source) != nullptr) {
        ScopedLock sl(callbackLock);

        listeners.call([](Callback& cb) {
            cb.audioDeviceChanged();
        });
    }
}

void Medley::loadNextTrack(Deck* currentDeck, bool play, Deck::OnLoadingDone onLoadingDone) {
    // Queue is empty, request to fill it with some tracks
    if (queue.count() <= 0) {
        ScopedLock sl(callbackLock);
        listeners.call([&](Callback& listener) {
            ScopedLock enqueueSl(enqueueLock);

            if (queue.count() > 0) {
                return;
            }

            listener.enqueueNext([&, _pQueue = &queue, p = play, _onLoadingDone = onLoadingDone](bool enqueueResult) {
                if (enqueueResult && _pQueue->count() > 0) {
                    // enqueue succeeded, try to load again using available deck
                    loadNextTrack(nullptr, p, _onLoadingDone);
                }
                else {
                    _onLoadingDone(false);
                }
            });
        });

        return;
    }

    // Fetch next track from queue
    if (queue.count() > 0) {
        if (auto track = queue.fetchNextTrack()) {
            auto nextDeck = getNextDeck(currentDeck);

            if (nextDeck == nullptr) {
                currentDeck->log(LogLevel::Error, "Could not find another deck");
                return;
            }

            if (nextDeck->_isTrackLoading) {
                nextDeck->log(LogLevel::Error, "Busy loading some track");
                nextDeck->unloadTrack();
            }

            const Deck::OnLoadingDone deckLoadingHandler = [this, _onLoadingDone = onLoadingDone, p = play, cd = currentDeck, _nextDeck = nextDeck](bool loadingResult) {
                if (loadingResult) {
                    _onLoadingDone(true);

                    if (p) {
                        _nextDeck->start();
                    }

                    return;
                }

                // Track loading failed, try again with next track
                loadNextTrack(nullptr, p, _onLoadingDone);
            };


            nextDeck->loadTrack(track, deckLoadingHandler);
        }

        return;
    }
}

void Medley::deckTrackScanning(Deck& sender)
{

}

void Medley::deckTrackScanned(Deck& sender)
{

}

Deck* Medley::getAvailableDeck() {
    for (auto& deck : decks) {
        if (deck->isTrackLoading() || deck->isTrackLoaded()) {
            continue;
        }

        return deck.get();
    }

    return nullptr;
}

Deck* Medley::getNextDeck(Deck* from)
{
    if (from == nullptr) {
        from = getMainDeck();
    }

    if (from == nullptr) {
        auto next = getAvailableDeck();
        return (next != nullptr) ? next : decks[0].get();
    }

    return decks[(from->index + 1) % numDecks].get();
}

Deck* Medley::getPreviousDeck(Deck* from)
{
    if (from == nullptr) {
        from = getMainDeck();
    }

    if (from == decks[0].get()) {
        return decks[2].get();
    }

    if (from == decks[1].get()) {
        return decks[0].get();
    }

    if (from == decks[2].get()) {
        return decks[1].get();
    }

    return decks[2].get();
}

Deck* Medley::getDeck(int index) const
{
    return index == -1 ? getMainDeck() : decks[index].get();
}

inline String Medley::getDeckName(Deck& deck) {
    return deck.getName();
}

void Medley::deckStarted(Deck& sender, TrackPlay& trackPlay) {
    sender.log(LogLevel::Debug, "Started");

    auto markedAsMain = false;

    auto prevDeck = getPreviousDeck(&sender);

    if (!prevDeck->track || decksTransition[prevDeck->index].state == DeckTransitionState::Idle) {
        sender.markAsMain(true);
        markedAsMain = true;
    }

    ScopedLock sl(callbackLock);
    listeners.call([&](Callback& cb) {
        cb.deckStarted(sender, trackPlay);

        if (markedAsMain) {
            cb.mainDeckChanged(sender, trackPlay);
        }
    });
}

void Medley::deckFinished(Deck& sender, TrackPlay& trackPlay) {
    decksTransition[sender.index].state = DeckTransitionState::Idle;

    ScopedLock sl(callbackLock);
    listeners.call([&](Callback& cb) {
        cb.deckFinished(sender, trackPlay);
    });
}

void Medley::deckLoaded(Deck& sender, TrackPlay& trackPlay)
{
    decksTransition[sender.index].state = DeckTransitionState::Idle;

    ScopedLock sl(callbackLock);
    listeners.call([&](Callback& cb) {
        cb.deckLoaded(sender, trackPlay);
    });
}

void Medley::deckUnloaded(Deck& sender, TrackPlay& trackPlay) {
    sender.log(LogLevel::Debug, "Unloaded");

    auto nextDeck = getNextDeck(&sender);

    if (&sender == transitingFromDeck.load()) {
        decksTransition[sender.index].fader.reset();
        decksTransition[sender.index].fader.resetTime();

        if (nextDeck->isTrackLoaded() && !nextDeck->hasStarted()) {
            sender.log(LogLevel::Warn, "Stopped before transition would happen, try starting next deck");
            nextDeck->start();
        }
    }

    decksTransition[sender.index].state = DeckTransitionState::Idle;
    transitingFromDeck.store(nullptr);
    nextDeck->setVolume(1.0f);

    if (forceFadingOut.load() > 0) {
        forceFadingOut--;
    }

    auto nextTrackLoaded = nextDeck->isTrackLoaded();
    sender.markAsMain(false);
    nextDeck->markAsMain(nextTrackLoaded);

    {
        listeners.call([&](Callback& cb) {
            ScopedLock sl(callbackLock);
            cb.deckUnloaded(sender, trackPlay);

            if (nextTrackLoaded && nextDeck->isMain()) {
                cb.mainDeckChanged(*nextDeck, nextDeck->getTrackPlay());
            }
        });
    }

    // Just in case
    if (keepPlaying && !hasAnyDeckStarted()) {
        auto shouldContinuePlaying = (nextDeck->getTrack() != nullptr) || (queue.count() > 0);

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

    auto enqueuePos = sender.getTransitionEnqueuePosition();
    auto cuePos = sender.getTransitionCuePosition();
    auto transitionStartPos = sender.getTransitionStartPosition();
    auto transitionEndPos = sender.getTransitionEndPosition();

    auto pTransition = &decksTransition[sender.index];
    auto pNextTransition = &decksTransition[nextDeck->index];

    if (pTransition->state < DeckTransitionState::NextIsReady) {
        // Idle, CueNext, NextIsLoading

        if (pTransition->state == DeckTransitionState::Idle) {
            // Idle
            if (position > enqueuePos) {
                if (queue.count() == 0)
                {
                    pTransition->state = DeckTransitionState::Enqueue;
                    ScopedLock sl(callbackLock);

                    auto pSender = &sender;
                    listeners.call([=, _sender = pSender](Callback& cb) {
                        enqueueLock.enter();

                        // In case a race condition has occured, return from this function and try it later
                        if (queue.count() > 0) {
                            enqueueLock.exit();
                            return;
                        }

                        cb.enqueueNext([=](bool done) {
                            if (done) {
                                pTransition->state = DeckTransitionState::CueNext;

                                if (keepPlaying && !hasAnyDeckStarted()) {
                                    // Playing has stopped during enqueuing phase and caused the timing to stop either
                                    // re-trigger timing
                                    logger->warn("Enqueuing had been stalled and could not provide track in time");
                                    deckPosition(*_sender, cuePos + 0.1);
                                    pTransition->state = DeckTransitionState::Idle;
                                    return;
                                }
                            }
                            else {
                                pTransition->state = DeckTransitionState::Idle; // Move back to the previous state, this will cause a retry
                            }

                            enqueueLock.exit();
                        });
                    });
                }
                else {
                    pTransition->state = DeckTransitionState::CueNext;
                }
            }
        }

        if (pTransition->state == DeckTransitionState::CueNext) {
            if (position > cuePos) {
                pTransition->state = DeckTransitionState::NextIsLoading;

                auto currentDeck = &sender;
                loadNextTrack(currentDeck, keepPlaying && !hasAnyDeckStarted(), [&, _pTransition = pTransition, _pNextTransition = pNextTransition, _position = position, tsp = transitionStartPos, tep = transitionEndPos, cd = currentDeck, nd = nextDeck](bool loaded) {
                    if (loaded) {
                        _pTransition->state = DeckTransitionState::NextIsReady;
                        transitingFromDeck.store(cd);

                            _pNextTransition->fader.start(_position, tep, 0.0f, 1.0f, fadingFactor * 0.5f);
                        if (forceFadingOut.load() > 0) {
                        }
                        else {
                            auto leadInDuration = !cd->disableNextTrackLeadIn ? nd->getLeadingDuration() : 0.0;
                            auto fadeInStart = jmax(0.0, tsp - leadInDuration, _position);
                            _pNextTransition->fader.start(fadeInStart, tsp, 0.25f, 1.0f, fadingFactor);
                        }
                    }
                    else {
                        _pTransition->state = DeckTransitionState::CueNext; // Move back to the previous state, this will cause a retry
                        transitingFromDeck.store(nullptr);

                        // No more track, do not transit
                        if (forceFadingOut.load() <= 0) {
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
    auto pTransition = &decksTransition[deck->index];

    auto transitionStartPos = deck->getTransitionStartPosition();
    auto transitionEndPos = deck->getTransitionEndPosition();

    auto nextDeck = getNextDeck(deck);

    if (pTransition->state >= DeckTransitionState::NextIsReady && nextDeck->isTrackLoaded()) {
        auto lastAudible = deck->getLastAudiblePosition();
        auto leadingDuration = !deck->disableNextTrackLeadIn ? nextDeck->getLeadingDuration() : 0.0;
        auto nextDeckStart = (transitionStartPos - leadingDuration) - 0.05 /* Correct clock drift caused by playhead timer */;
        auto hasLongLeadIn = leadingDuration >= minimumLeadingToFade;

        if (nextDeckStart > lastAudible) {
            nextDeckStart = lastAudible - 0.01;
        }

        if (position > nextDeckStart) {
            if (pTransition->state == DeckTransitionState::NextIsReady) {
                nextDeck->log(LogLevel::Debug, "Transiting to this deck");

                pTransition->state = DeckTransitionState::TransitToNext;

                nextDeck->setVolume(1.0f);
                nextDeck->setPosition(nextDeck->getFirstAudiblePosition());

                if (forceFadingOut.load() > 0) {
                    if (hasLongLeadIn) {
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

                        decksTransition[nextDeck->index].fader.start(position, transitionEndPos, 0.25f, 1.0f, fadingFactor);
                    }
                    else if (hasLongLeadIn) {
                        auto fadeInStart = jmax(0.0, transitionStartPos - leadingDuration, position);
                        decksTransition[nextDeck->index].fader.start(fadeInStart, transitionStartPos, 0.25f, 1.0f, fadingFactor);
                    }
                }

                pTransition->fader.start(transitionStartPos, transitionEndPos + 0.01, 1.0f, 0.0f, fadingFactor);
                nextDeck->setVolume(decksTransition[nextDeck->index].fader.getFrom());
                nextDeck->start();
            }

            // Fade in next
            auto newVolume = 1.0f;

            if (hasLongLeadIn) {
                // Keep in mind that fading during a transition is always based on main deck timing
                if (position >= decksTransition[nextDeck->index].fader.getTimeStart()) {
                    newVolume = decksTransition[nextDeck->index].fader.update(position);
                }
                else {
                    newVolume = decksTransition[nextDeck->index].fader.getFrom();
                }
            }

            if (newVolume != nextDeck->getVolume()) {
                nextDeck->log(LogLevel::Trace, String::formatted("Fading in: %.2f", newVolume).toStdString());
                nextDeck->setVolume(newVolume);
            }
        }
    }

    // Fade out current
    if (deck->isMain()) {
        auto shouldFade = pTransition->fader.isReversed() && (forceFadingOut.load() > 0 || pTransition->state >= DeckTransitionState::NextIsReady);
        if (shouldFade) {
            auto currentVolume = deck->getVolume();

            auto newVolume = position >= pTransition->fader.getTimeStart() ? pTransition->fader.update(position) : 1.0f;
            if (newVolume != currentVolume) {
                deck->log(LogLevel::Trace, String::formatted("Fading out: %.2f", newVolume).toStdString());
                deck->setVolume(newVolume);
            }
        }
    }

    if (position >= transitionEndPos) {
        if (pTransition->state != DeckTransitionState::Idle) {
            forceFadingOut.store(0);
            deck->stop();
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

int Medley::getOutputLatency()
{
    auto device = getCurrentAudioDevice();
    auto latency = device->getOutputLatencyInSamples();

#ifdef JUCE_WINDOWS
        if (device->getTypeName() == "DirectSound") {
            latency *= 16;
        }
#endif

    return latency;
}

double Medley::getOutputSampleRate()
{
    return getCurrentAudioDevice()->getCurrentSampleRate();
}

Deck* Medley::getMainDeck() const
{
    for (const auto& deck : decks) {
        if (deck->isMain()) {
            return deck.get();
        }
    }

    return nullptr;
}

void Medley::setFadingCurve(double curve) {
    fadingCurve = jlimit(0.0, 100.0, curve);
    updateFadingFactor();
}

bool Medley::play(bool shouldFade)
{
    if (!hasAnyDeckStarted()) {
        bool shouldLoadNextTrack = true;

        for (auto& deck : decks) {
            if (deck->_isTrackLoading || deck->isTrackLoaded()) {
                if (deck->start()) {
                    shouldLoadNextTrack = false;
                    break;
                }
            }
        }

        if (shouldLoadNextTrack) {
            loadNextTrack(nullptr, true);
        }
    }

    keepPlaying = true;
    mixer.setPause(false, shouldFade && mixer.isPaused());

    return true;
}

void Medley::stop(bool shouldFade)
{
    auto stopAndUnload = [this]() {
        keepPlaying = false;

        for (auto& deck : decks) {
            deck->stop();
            deck->unloadTrack();
        }
    };

    if (!shouldFade) {
        stopAndUnload();
        return;
    }

    mixer.fadeOut(400, stopAndUnload);
}

bool Medley::hasAnyDeckStarted()
{
    for (const auto& deck : decks) {
        if (deck->hasStarted()) {
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

void Medley::setReplayGainBoost(float decibels)
{
    for (auto& deck : decks) {
        deck->setReplayGainBoost(decibels);
    }
}

int Medley::AudioInterceptor::useTimeSlice()
{
    AudioBuffer<float> buffer;

    {
        ScopedLock sl(lock);
        if (buffers.empty()) {
            return 5;
        }

        buffer = buffers.front();
        buffers.pop();
    }

    medley.dispatchAudio(AudioSourceChannelInfo(&buffer, 0, buffer.getNumSamples()), medley.getCurrentTime());

    return 5;
}

void Medley::AudioInterceptor::addBuffer(AudioBuffer<float>& buffer, int startSample, int numSamples)
{
    AudioBuffer<float> newBuffer(buffer.getNumChannels(), numSamples);

    for (int i = buffer.getNumChannels(); --i >= 0;) {
        newBuffer.copyFrom(i, 0, buffer, i, startSample, numSamples);
    }

    {
        ScopedLock sl(lock);
        buffers.push(newBuffer);
    }
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
        fader.start(start, end, faderGain, 0.0f, 2.0f, -1.0f, [=]() {
            paused = true;
        });
    }
    else {
        // unpause
        paused = false;
        fader.start(start, end, faderGain, 1.0f, 2.0f, -1.0f, [=]() {

        });
    }
}


bool Medley::Mixer::togglePause(bool fade) {
    setPause(!paused, fade);
    return !paused;
}

void Medley::Mixer::getNextAudioBlock(const AudioSourceChannelInfo& info) {
    currentTime = Time::getMillisecondCounterHiRes();

    if (!outputStarted) {
        outputStarted = true;

        medley.logger->info("Output started");
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

    if (prepared) {
        // Main Volume
        {
            faderGain = fader.update(currentTime);
            for (int i = info.buffer->getNumChannels(); --i >= 0;) {
                info.buffer->applyGainRamp(i, info.startSample, info.numSamples, lastFaderGain, faderGain);
            }
            lastFaderGain = faderGain;
        }

        for (int i = info.buffer->getNumChannels(); --i >= 0;) {
            tapBuffer.copyFrom(i, 0, info.buffer->getReadPointer(i), info.buffer->getNumSamples());
        }

        {
            processor.process(info, currentTime);
        }

        // Tap
        medley.audioInterceptor.addBuffer(tapBuffer, info.startSample, info.numSamples);
    }
}

void Medley::Mixer::changeListenerCallback(ChangeBroadcaster* source) {
    updateAudioConfig();
}

int Medley::Mixer::useTimeSlice()
{
    processor.updateLevelTracker();
    return 5;
}

void Medley::Mixer::fadeOut(double durationMs, Fader::OnDone callback)
{
    fader.start(currentTime, currentTime + durationMs, faderGain, 0.0f, 2.0f, -1.0f, callback);
}

void Medley::Mixer::updateAudioConfig()
{
    if (auto device = medley.getCurrentAudioDevice()) {
        auto config = medley.getAudioDeviceSetup();

        int latencyInSamples = medley.getOutputLatency();

        {
            ScopedLock sl(medley.audioCallbackLock);

            if (medley.audioCallback) {
                medley.audioCallback->audioDeviceUpdate(device, config);
            }
        }

        auto numSamples = device->getCurrentBufferSizeSamples();
        numChannels = device->getOutputChannelNames().size();
        sampleRate = (int)config.sampleRate;

        tapBuffer.setSize(numChannels, numSamples);

        ProcessSpec audioSpec{ config.sampleRate, (uint32)numSamples, (uint32)numChannels };

        processor.prepare(audioSpec, latencyInSamples);

        prepared = true;
    }
}

int Medley::PlaybackWatchdog::useTimeSlice()
{
    constexpr int SLEEP_DURATION = 5000;
    constexpr int WAIT_DURATION = SLEEP_DURATION / 2;

    if (!medley.keepPlaying) {
        return SLEEP_DURATION;
    }

    if (medley.hasAnyDeckStarted()) {
        return SLEEP_DURATION;
    }

    // No decks have been started
    for (auto& deck : medley.decks) {
        // but it is loading, just wait a little more
        if (deck->isTrackLoading()) {
            return WAIT_DURATION;
        }

        if (deck->isTrackLoaded()) {
            if (deck->start()) {
                return WAIT_DURATION;
            }
        }
    }

    // Reaching this point means all decks are empty
    medley.loadNextTrack(nullptr, true);
    return WAIT_DURATION;
}

}
