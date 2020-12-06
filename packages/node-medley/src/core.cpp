#include "core.h"

FunctionReference Queue::ctor;

void Queue::Initialize(Object& exports) {
    auto proto = {
        InstanceMethod<&Queue::add>("add")
    };

    auto env = exports.Env();
    auto constructor = DefineClass(env, "Queue", proto);

    ctor = Persistent(constructor);
    ctor.SuppressDestruct();

    exports.Set("Queue", constructor);
}

medley::ITrack::Ptr Queue::fetchNextTrack() {
    return !isEmpty() ? new Track(removeAndReturn(0)) : nullptr;
}

void Queue::add(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return;
    }

    Arr::add(juce::String(info[0].ToString().Utf8Value()));
}

namespace {

class Worker : public AsyncWorker {
public:
    Worker(Function& callback)
        : AsyncWorker(callback)
    {

    }

    void Execute() override {
        while (running) {
            juce::Thread::sleep(10);
        }
    }

    void shutdown() {
        running = false;
    }

    bool running = true;
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
        InstanceMethod<&Medley::stop>("stop")
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

    queue = Queue::Unwrap(obj);
    engine = new Engine(*queue);

    ensureWorker(info.Env());
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