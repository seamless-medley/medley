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

    static void Medley::shutdown(const CallbackInfo& info);

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

    void play(const CallbackInfo& info);

    void stop(const CallbackInfo& info);

    Napi::Value togglePause(const CallbackInfo& info);

    void fadeOut(const CallbackInfo& info);

    void seek(const CallbackInfo& info);

    void seekFractional(const CallbackInfo& info);

    Napi::Value level(const CallbackInfo& info);

    Napi::Value playing(const CallbackInfo& info);

    Napi::Value paused(const CallbackInfo& info);

    Napi::Value duration(const CallbackInfo& info);

    Napi::Value getPosition(const CallbackInfo& info);

    void setPosition(const CallbackInfo& info, const Napi::Value& value);
private:
    void emitDeckEvent(const std::string& name,  medley::Deck& deck);

    ObjectReference queueJS;
    Queue* queue;
    Engine* engine;

    Reference<Napi::Value> self;
    ThreadSafeFunction threadSafeEmitter;
};
