#include "queue.h"

namespace {
static Track createInternalTrackFromJS(const CallbackInfo& info) {
    // TODO: Accept String or Object
    return Track(juce::String(info[0].ToString().Utf8Value()));
}
}

FunctionReference Queue::ctor;

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

    Arr::add(createInternalTrackFromJS(info));
}