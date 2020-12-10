#include "core.h"

namespace {

class Worker : public AsyncWorker {
public:
    Worker(Function& callback)
        : AsyncWorker(callback)
    {

    }

    void Execute() override {
        JUCE_TRY
        {
            // loop until a quit message is received..
            MessageManager::getInstance()->runDispatchLoop();
        }
        JUCE_CATCH_EXCEPTION
    }

    void shutdown() {
        MessageManager::getInstance()->stopDispatchLoop();
    }
};

Worker* worker = nullptr;
std::atomic<int> workerRefCount = 0;

void ensureWorker(Env& env) {
    workerRefCount++;

    if (worker) {
        return;
    }

    worker = new Worker(Function::New<Medley::workerFinalizer>(env));
    worker->Queue();
}

void shutdownWorker() {
    if (worker) {
        worker->shutdown();
        worker = nullptr;

        JUCE_AUTORELEASEPOOL
        {
            DeletedAtShutdown::deleteAll();
            MessageManager::deleteInstance();
        }
    }
}

void decWorkerRefCount() {
    if (workerRefCount-- <= 0) {
        shutdownWorker();
    }
}

}

void Medley::Initialize(Object& exports) {
    auto proto = {
        StaticMethod<&Medley::shutdown>("shutdown"),
        //
        InstanceMethod<&Medley::play>("play"),
        InstanceMethod<&Medley::stop>("stop"),
        InstanceMethod<&Medley::togglePause>("togglePause"),
        InstanceMethod<&Medley::fadeOut>("fadeOut"),
        InstanceMethod<&Medley::seek>("seek"),
        InstanceMethod<&Medley::seekFractional>("seekFractional"),
        //
        InstanceAccessor<&Medley::level>("level"),
        InstanceAccessor<&Medley::playing>("playing"),
        InstanceAccessor<&Medley::paused>("paused"),
        InstanceAccessor<&Medley::duration>("duration"),
        InstanceAccessor<&Medley::getPosition, &Medley::setPosition>("position"),
        InstanceAccessor<&Medley::getGain, &Medley::setGain>("gain"),
    };

    auto env = exports.Env();
    exports.Set("Medley", DefineClass(env, "Medley", proto));
}

void Medley::shutdown(const CallbackInfo& info) {
    shutdownWorker();
}

void Medley::workerFinalizer(const CallbackInfo&) {

}

Medley::Medley(const CallbackInfo& info)
    : ObjectWrap<Medley>(info)
{
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return;
    }

    auto arg1 = info[0];
    if (!arg1.IsObject()) {
        TypeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return;
    }

    auto obj = arg1.ToObject();

    if (!obj.InstanceOf(Queue::ctor.Value())) {
        TypeError::New(env, "Is not a queue").ThrowAsJavaScriptException();
        return;
    }

    self = Persistent(info.This());
    queueJS = Persistent(obj);

    try {
        ensureWorker(info.Env());

        queue = Queue::Unwrap(obj);
        engine = new Engine(*queue);
        engine->addListener(this);

        threadSafeEmitter = ThreadSafeFunction::New(
            env, info.This().ToObject().Get("emit").As<Function>(),
            "Medley Emitter",
            0, 1
        );
    }
    catch (std::exception& e) {
        throw Napi::Error::New(info.Env(), e.what());
    }
    catch (...) {
        throw Napi::Error::New(info.Env(), "Unknown Error while initializing engine.");
    }
}

Medley::~Medley() {
    delete engine;
    delete queue;
    //
    decWorkerRefCount();
}

void Medley::deckTrackScanning(medley::Deck& sender) {

}

void Medley::deckTrackScanned(medley::Deck& sender) {

}

void Medley::deckPosition(medley::Deck& sender, double position) {

}

void Medley::deckStarted(medley::Deck& sender) {
    emitDeckEvent("started", sender);
}

void Medley::deckFinished(medley::Deck& sender) {
    emitDeckEvent("finished", sender);
}

void Medley::deckLoaded(medley::Deck& sender) {
    emitDeckEvent("loaded", sender);
}

void Medley::deckUnloaded(medley::Deck& sender) {
    emitDeckEvent("unloaded", sender);
}

void Medley::emitDeckEvent(const std::string& name,  medley::Deck& deck) {
    auto index = &deck == &engine->getDeck1() ? 0 : 1;

    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function fn) {
        fn.Call(self.Value(), {
            Napi::String::New(env, name),
            Number::New(env, index)
        });
    });
}

void Medley::play(const CallbackInfo& info) {
    engine->play();
}

void Medley::stop(const CallbackInfo& info) {
    engine->stop();
}

Napi::Value Medley::togglePause(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->togglePause());
}

void Medley::fadeOut(const CallbackInfo& info) {
    engine->fadeOutMainDeck();
}

void Medley::seek(const CallbackInfo& info) {
    engine->setPositionInSeconds(info[0].ToNumber().DoubleValue());
}

void Medley::seekFractional(const CallbackInfo& info) {
    engine->setPositionFractional(info[0].ToNumber().DoubleValue());
}

Napi::Value Medley::level(const CallbackInfo& info) {
    auto env = info.Env();

    auto left = Object::New(env);
    left.Set("magnitude",  Number::New(env, engine->getLevel(0)));
    left.Set("peak",  Number::New(env, engine->getPeakLevel(0)));

    auto right = Object::New(env);
    right.Set("magnitude",  Number::New(env, engine->getLevel(1)));
    right.Set("peak",  Number::New(env, engine->getPeakLevel(1)));

    auto result = Object::New(env);
    result.Set("left", left);
    result.Set("right", right);

    return result;
}

Napi::Value Medley::playing(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->isPlaying());
}

Napi::Value Medley::paused(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->isPaused());
}

Napi::Value Medley::duration(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getDuration());
}

Napi::Value Medley::getPosition(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getPositionInSeconds());
}

void Medley::setPosition(const CallbackInfo& info, const Napi::Value& value) {
    engine->setPositionInSeconds(value.ToNumber().DoubleValue());
}

Napi::Value Medley::getGain(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getGain());
}

void Medley::setGain(const CallbackInfo& info, const Napi::Value& value) {
    engine->setGain(value.ToNumber().DoubleValue());
}