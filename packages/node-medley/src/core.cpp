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
        //
        InstanceAccessor<&Medley::level>("level")
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

    ensureWorker(info.Env());

    queue = Queue::Unwrap(obj);
    engine = new Engine(*queue);
}

Medley::~Medley() {
    delete engine;
    delete queue;
    //
    decWorkerRefCount();
}

void Medley::play(const CallbackInfo& info) {
    engine->play();
}

void Medley::stop(const CallbackInfo& info) {
    engine->stop();
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