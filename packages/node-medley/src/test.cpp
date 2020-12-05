#include <napi.h>
#include <Windows.h>
#include "Medley.h"

using namespace Napi;

class Track : public medley::ITrack {
public:
    Track(juce::String& path)
        : file(path)
    {

    }

    Track(File& file)
        : file(file)
    {

    }

    File getFile() {
        return file;
    }

private:
    File file;
};

class Queue : public ObjectWrap<Queue>, public juce::Array<juce::String>, public medley::IQueue {
public:
    using Arr = Array<juce::String>;

    static void Initialize(Object& exports) {
        auto proto = {
            InstanceMethod<&Queue::add>("add")
        };

        auto env = exports.Env();
        auto constructor = DefineClass(env, "Queue", proto);

        ctor = Persistent(constructor);
        ctor.SuppressDestruct();

        exports.Set("Queue", constructor);
    }

    Queue(const CallbackInfo& info)
        : ObjectWrap<Queue>(info)
    {

    }

    size_t count() const {
        return size();
    }

    medley::ITrack::Ptr fetchNextTrack() {
        return !isEmpty() ? new Track(removeAndReturn(0)) : nullptr;
    }

    void add(const CallbackInfo& info) {
        auto env = info.Env();

        if (info.Length() < 1) {
            TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
            return;
        }

        Arr::add(juce::String(info[0].ToString().Utf8Value()));
    }

    static FunctionReference ctor;

private:

};

FunctionReference Queue::ctor;

class Medley : public ObjectWrap<Medley> {
public:
    using Engine = medley::Medley;

    static void Initialize(Object& exports) {
        auto proto = {
            InstanceMethod<&Medley::play>("play")
        };

        auto env = exports.Env();
        exports.Set("Medley", DefineClass(env, "Medley", proto));
    }

    class Worker : public AsyncWorker {
    public:
        Worker(Function& callback)
            : AsyncWorker(callback)
        {

        }

        void Execute() override {
            while (true /* !shutdown */) {
                juce::Thread::sleep(10);
            }
        }
    };

    Medley(const CallbackInfo& info)
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

        auto worker = new Worker(Function::New<Medley::xx>(info.Env()));
        worker->Queue();
    }

    static void xx(const CallbackInfo&) {
        std::cout << "Worker done\n";
    }

    ~Medley() {
        delete engine;
        delete queue;
    }

    void play(const CallbackInfo& info) {
        engine->play();
    }

    ObjectReference queueJS;
    Queue* queue;
    Engine* engine;

    Reference<Napi::Value> self;
};

Object Init(Env env, Object exports) {
    Medley::Initialize(exports);
    Queue::Initialize(exports);
    return exports;
}

NODE_API_MODULE(medley, Init)