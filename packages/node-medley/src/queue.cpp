#include "queue.h"

namespace {
static Track createTrackFromJS(const Napi::Value p) {
    juce::String path;
    float preGain = 1.0f;

    if (p.IsObject()) {
        auto obj = p.ToObject();

        path = obj.Get("path").ToString().Utf8Value();
        preGain = obj.Get("preGain").ToNumber();
    } else {
        path = p.ToString().Utf8Value();
    }

    return Track(juce::String(path), preGain);
}
}

FunctionReference Queue::ctor;

Queue::Queue(const CallbackInfo& info)
    : ObjectWrap<Queue>(info)
{
    auto p = info[0];

    if (p.IsArray()) {
        auto arr = p.As<Napi::Array>();
        for (uint32_t index = 0; index < arr.Length(); index++) {
            Arr::add(createTrackFromJS(arr.Get(index)));
        }
    } else if (!p.IsUndefined() && !p.IsNull()) {
        Arr::add(createTrackFromJS(p));
    }
}

void Queue::Initialize(Object& exports) {
    auto proto = {
        InstanceAccessor<&Queue::length>("length"),

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

    auto p = info[0];

    if (p.IsArray()) {
        auto arr = p.As<Napi::Array>();
        for (uint32_t index = 0; index < arr.Length(); index++) {
            Arr::add(createTrackFromJS(arr.Get(index)));
        }
    } else if (!p.IsUndefined() && !p.IsNull()) {
        Arr::add(createTrackFromJS(p));
    }
}