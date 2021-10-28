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

    deck1 = new Deck("Deck A", formatMgr, loadingThread, readAheadThread);
    deck2 = new Deck("Deck B", formatMgr, loadingThread, readAheadThread);

    deck1->addListener(this);
    deck2->addListener(this);

    loadingThread.startThread(6);
    readAheadThread.startThread(9);
    visualizingThread.startThread();

    mixer.addInputSource(deck1, false);
    mixer.addInputSource(deck2, false);

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
    deck1->removeListener(this);
    deck2->removeListener(this);
    //
    mixer.removeAllInputs();
    mainOut.setSource(nullptr);

    loadingThread.stopThread(100);
    readAheadThread.stopThread(100);
    visualizingThread.stopThread(100);

    deviceMgr.closeAudioDevice();

    delete deck1;
    delete deck2;
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
    if (transitionState == TransitionState::Transit) {
        if (auto anotherDeck = getAnotherDeck(deck)) {
            auto position = deck->getPosition();

            auto cuePosition = deck->getTransitionCuePosition();
            auto transitionStartPos = deck->getTransitionStartPosition();
            auto transitionEndPos = deck->getTransitionEndPosition();

            auto first = anotherDeck->getFirstAudiblePosition();
            auto leadingDuration = anotherDeck->getLeadingDuration();
            auto nextDeckStart = transitionStartPos - leadingDuration;

            auto nextDeckPosition = jmax(position - nextDeckStart + first, first);
            anotherDeck->setPosition(nextDeckPosition);

            if (position < nextDeckStart) {
                anotherDeck->internalPause();
                anotherDeck->setVolume(1.0f);
                transitionState = TransitionState::Cued;
            }

            if (position < transitionStartPos) {
                auto fadeInStart = transitionStartPos - leadingDuration;
                faderIn.start(fadeInStart, fadeInStart + leadingDuration, 0.25f, 1.0f, fadingFactor);
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
    deck1->setMaximumFadeOutDuration(value);
    deck2->setMaximumFadeOutDuration(value);
}

void Medley::fadeOutMainDeck()
{
    if (auto deck = getMainDeck()) {
        forceFadingOut++;

        if (deck != nullptr && deck == transitingDeck && deck->isFading()) {
            transitingDeck->unloadTrack();
            deck = getAnotherDeck(deck);
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

void Medley::loadNextTrack(Deck* currentDeck, bool play, Deck::OnLoadingDone callback) {
    auto nextDeck = getAnotherDeck(currentDeck);

    if (nextDeck == nullptr) {
        currentDeck->log("Could not find another deck");
        return;
    }

    if (nextDeck->isTrackLoading) {
        nextDeck->log("is busy loading some track");
        nextDeck->unloadTrack();
    }

    auto pQueue = &queue;
    Deck::OnLoadingDone loadingHandler = [&, _callback = callback, p = play, _pQueue = pQueue, _nextDeck = nextDeck](bool loadingResult) {
        if (loadingResult) {
            _callback(true);

            if (p) {
                _nextDeck->start();
            }

            return;
        }

        if (_pQueue->count() > 0) {
            auto track = _pQueue->fetchNextTrack();
            _nextDeck->loadTrack(track, loadingHandler);
        } else {
            Logger::writeToLog("Track loading has failed and there is no next track left in queue, try PRE CUE");

            ScopedLock sl(callbackLock);
            listeners.call([&](Callback& cb) {
                cb.preQueueNext([&, _pQueue = pQueue, cd = currentDeck, p = play, _callback = callback](bool preCueDone) {
                    if (preCueDone && _pQueue->count() > 0) {
                        loadNextTrack(cd, p, _callback);
                    }
                    else {
                        _callback(false);
                    }
                });
            });
        }
    };

    if (queue.count() > 0) {
        auto track = queue.fetchNextTrack();
        nextDeck->loadTrack(track, loadingHandler);
    } else {
        ScopedLock sl(callbackLock);
        listeners.call([&](Callback& cb) {
            cb.preQueueNext([&, _pQueue = pQueue, cd = currentDeck, p = play, _callback = callback](bool preCueDone) {
                if (preCueDone && _pQueue->count() > 0) {
                    loadNextTrack(cd, p, _callback);
                }
                else {
                    _callback(false);
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
    return !deck1->isTrackLoaded() ? deck1 : (!deck2->isTrackLoaded() ? deck2 : nullptr);
}

Deck* Medley::getAnotherDeck(Deck* from) {
    if (from == nullptr) {
        from = getMainDeck();
    }

    return (from == deck1) ? deck2 : deck1;
}

inline String Medley::getDeckName(Deck& deck) {
    return deck.getName();
}

void Medley::deckStarted(Deck& sender) {
    sender.log("Started");

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
    sender.log("Unloaded");

    if (&sender == transitingDeck) {
        faderOut.reset();
    }

    auto nextDeck = getAnotherDeck(transitingDeck);

    if (&sender == transitingDeck) {
        if (transitionState == TransitionState::Cued) {
            sender.log("stopped before transition would happen, try starting next deck");
            if (nextDeck->isTrackLoaded()) {
                nextDeck->start();
            }
        }
    }

    transitionState = TransitionState::Idle;
    transitingDeck = nullptr;
    nextDeck->setVolume(1.0f);

    if (forceFadingOut > 0) {
        forceFadingOut--;
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

    if (sender.isMain()) {
        auto transitionPreCuePoint = sender.getTransitionPreCuePosition();
        auto transitionCuePoint = sender.getTransitionCuePosition();
        auto transitionStartPos = sender.getTransitionStartPosition();
        auto transitionEndPos = sender.getTransitionEndPosition();


        if (transitionState < TransitionState::Cued) {
            if (transitionState == TransitionState::Idle && position > transitionPreCuePoint) {
                transitionState = TransitionState::Cueing;

                {
                    ScopedLock sl(callbackLock);

                    listeners.call([](Callback& cb) {
                        cb.preQueueNext();
                    });
                }
            }

            if (transitionState < TransitionState::CueLoading && position > transitionCuePoint) {
                transitionState = TransitionState::CueLoading;

                auto currentDeck = &sender;
                loadNextTrack(currentDeck, false, [&, p = position, tsp = transitionStartPos, tep = transitionEndPos, cd = currentDeck, nd = nextDeck](bool loaded) {
                    if (!loaded) {
                        transitionState = TransitionState::Cueing;
                        transitingDeck = nullptr;

                        // No more track, do not transit
                        if (forceFadingOut <= 0) {
                            return;
                        }
                    } else {
                        transitionState = TransitionState::Cued;
                        transitingDeck = cd;

                        if (forceFadingOut > 0) {
                            faderIn.start(p, tep, 0.0f, 1.0f, fadingFactor * 0.5f);
                        }
                        else {
                            auto leadIn = nd->getLeadingDuration();
                            auto fadeInStart = tsp - leadIn;
                            faderIn.start(fadeInStart, fadeInStart + leadIn, 0.25f, 1.0f, fadingFactor);
                        }
                    }

                    doTransition(cd, p);
                });
            }

            if (!sender.isMain() && nextDeck->isTrackLoaded() && !nextDeck->isPlaying()) {
                nextDeck->fireFinishedCallback();
            }

            return;
        }

        doTransition(&sender, position);
    }
    // Just in case
    else if (!deckQueue.empty()) {
        if (deckQueue.front() == &sender) {
            sender.markAsMain(true);
        }
    }
}

void Medley::doTransition(Deck* deck, double position)
{
    if (!deck->isMain()) {
        return;
    }

    auto nextDeck = getAnotherDeck(deck);
    if (nextDeck == nullptr) {
        return;
    }

    auto transitionStartPos = deck->getTransitionStartPosition();
    auto transitionEndPos = deck->getTransitionEndPosition();

    auto leadingDuration = nextDeck->getLeadingDuration();
    auto nextDeckStart = transitionStartPos - leadingDuration;

    if (position > nextDeckStart) {
        if (transitionState == TransitionState::Cued) {
            if (nextDeck->isTrackLoaded()) {
                nextDeck->log("Transiting to this deck");
                transitionState = TransitionState::Transit;
                nextDeck->setVolume(1.0f);
                nextDeck->setPosition(nextDeck->getFirstAudiblePosition());

                if (forceFadingOut > 0) {
                    if (leadingDuration >= minimumLeadingToFade) {
                        nextDeck->setPosition(nextDeck->getFirstAudiblePosition() + leadingDuration - minimumLeadingToFade);
                    }
                }

                faderOut.start(transitionStartPos, transitionEndPos, 1.0f, 0.0f, fadingFactor);
                nextDeck->start();
            }
        }

        auto newVolume = (leadingDuration > minimumLeadingToFade) ? faderIn.update(position) : 1.0f;
        if (newVolume != nextDeck->getVolume()) {
            //nextDeck->log(String::formatted("Fading in: %.2f", newVolume));
            nextDeck->setVolume(newVolume);
        }
    }

    auto currentVolume = deck->getVolume();
    auto newVolume = faderOut.update(position);
    if (newVolume != currentVolume) {
        //deck->log(String::formatted("Fading out: %.2f", newVolume));
        deck->setVolume(newVolume);
    }

    if (position >= transitionStartPos) {
        auto transitionDuration = (transitionEndPos - transitionStartPos);
        auto transitionProgress = jlimit(0.0, 1.0, (position - transitionStartPos) / transitionDuration);

        if (transitionState != TransitionState::Idle && position > transitionEndPos) {
            if (transitionProgress >= 1.0) {
                forceFadingOut = 0;
                deck->stop();
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
    mixer.setPause(false, mixer.isPaused());
}

void Medley::stop()
{
    mixer.fadeOut(400, [=]() {
        keepPlaying = false;

        deck1->stop();
        deck2->stop();

        deck1->unloadTrack();
        deck2->unloadTrack();
    });
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

void medley::Medley::setAudioCallback(AudioCallback* callback)
{
    ScopedLock sl(audioCallbackLock);
    audioCallback = callback;
}

void Medley::updateFadingFactor() {
    double outRange = 1000.0 - 1.0;
    double inRange = 100.0;

    fadingFactor = (float)(1000.0 / (((100.0 - fadingCurve) / inRange * outRange) + 1.0));
    // TODO: Update both decks
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

    gain = fader.update(currentTime);

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
