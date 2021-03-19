#pragma once

#include <napi.h>
#include <Medley.h>
#include "track.h"
#include "queue.h"

using namespace Napi;

using Engine = medley::Medley;

class Medley : public ObjectWrap<Medley>, public Engine::Callback {
public:

    static void Initialize(Object& exports);

    static void shutdown(const CallbackInfo& info);

    static void workerFinalizer(const CallbackInfo&);

    Medley(const CallbackInfo& info);

    ~Medley();

    void deckTrackScanning(medley::Deck& sender) override;

    void deckTrackScanned(medley::Deck& sender) override;

    void deckPosition(medley::Deck& sender, double position) override;

    void deckStarted(medley::Deck& sender) override;

    void deckFinished(medley::Deck& sender) override;

    void deckLoaded(medley::Deck& sender) override;

    void deckUnloaded(medley::Deck& sender) override;

    void audioDeviceChanged() override;

    void preCueNext(Engine::Callback::PreCueNextDone done) override;

    void play(const CallbackInfo& info);

    void stop(const CallbackInfo& info);

    Napi::Value togglePause(const CallbackInfo& info);

    void fadeOut(const CallbackInfo& info);

    void seek(const CallbackInfo& info);

    void seekFractional(const CallbackInfo& info);

    Napi::Value isTrackLoadable(const CallbackInfo& info);

    Napi::Value level(const CallbackInfo& info);

    Napi::Value playing(const CallbackInfo& info);

    Napi::Value paused(const CallbackInfo& info);

    Napi::Value duration(const CallbackInfo& info);

    Napi::Value getPosition(const CallbackInfo& info);

    void setPosition(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getGain(const CallbackInfo& info);

    void setGain(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getFadingCurve(const CallbackInfo& info);

    void setFadingCurve(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getMaxTransitionTime(const CallbackInfo& info);

    void setMaxTransitionTime(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getMaxLeadingDuration(const CallbackInfo& info);

    void setMaxLeadingDuration(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getAvailableDevices(const CallbackInfo& info);

    Napi::Value setAudioDevice(const CallbackInfo& info);
private:
    void emitDeckEvent(const std::string& name,  medley::Deck& deck);

    ObjectReference queueJS;
    Queue* queue = nullptr;
    Engine* engine = nullptr;

    Reference<Napi::Value> self;
    ThreadSafeFunction threadSafeEmitter;
};
