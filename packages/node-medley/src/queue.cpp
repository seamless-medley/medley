#include "queue.h"

FunctionReference Queue::ctor;

Queue::Queue(const CallbackInfo& info)
    : ObjectWrap<Queue>(info)
{
    auto p = info[0];

    if (p.IsArray()) {
        auto arr = p.As<Napi::Array>();
        for (uint32_t index = 0; index < arr.Length(); index++) {
            Arr::add(Track::fromJS(arr.Get(index)));
        }
    } else if (!p.IsUndefined() && !p.IsNull()) {
        Arr::add(Track::fromJS(p));
    }
}

void Queue::Initialize(Object& exports) {
    auto proto = {
        InstanceAccessor<&Queue::length>("length"),

        InstanceMethod<&Queue::add>("add"),
        InstanceMethod<&Queue::clear>("clear"),
        InstanceMethod<&Queue::isEmpty>("isEmpty"),
        InstanceMethod<&Queue::insert>("insert"),
        InstanceMethod<&Queue::del>("delete"),
        InstanceMethod<&Queue::swap>("swap"),
        InstanceMethod<&Queue::move>("move"),
        InstanceMethod<&Queue::get>("get"),
        InstanceMethod<&Queue::set>("set"),
        InstanceMethod<&Queue::toArray>("toArray")
    };

    auto env = exports.Env();
    auto constructor = DefineClass(env, "Queue", proto);

    ctor = Persistent(constructor);
    ctor.SuppressDestruct();

    exports.Set("Queue", constructor);
}

medley::ITrack::Ptr Queue::fetchNextTrack() {
    return !Arr::isEmpty() ? new Track(removeAndReturn(0)) : nullptr;
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

        auto tracks = std::make_unique<Track[]>(arr.Length());

        for (uint32_t index = 0; index < arr.Length(); index++) {
            tracks[index] = Track::fromJS(arr.Get(index));
        }

        Arr::addArray(tracks.get(), arr.Length());
    } else if (!p.IsUndefined() && !p.IsNull()) {
        Arr::add(Track::fromJS(p));
    }
}

void Queue::clear(const CallbackInfo& info) {
    Arr::clear();
}

Napi::Value Queue::isEmpty(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), Arr::isEmpty());
}

void Queue::insert(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 2) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return;
    }

    auto at = info[0].ToNumber().Uint32Value();
    auto p = info[1];

    if (p.IsArray()) {
        auto arr = p.As<Napi::Array>();

        auto tracks = std::make_unique<Track[]>(arr.Length());

        for (uint32_t index = 0; index < arr.Length(); index++) {
            tracks[index] = Track::fromJS(arr.Get(index));
        }

        Arr::insertArray(at, tracks.get(), arr.Length());
    } else if (!p.IsUndefined() && !p.IsNull()) {
        Arr::insert(at, Track::fromJS(p));
    }
}

void Queue::del(const CallbackInfo& info) {{
    if (info.Length() >= 2) {
        auto from = info[0].ToNumber();
        auto count = info[1].ToNumber();

        Arr::removeRange(from, count);
        return;
    }

    if (info.Length() > 0) {
        auto p = info[0];
        auto index = p.IsNumber() ? p.ToNumber() : Arr::indexOf(juce::String(p.ToString().Utf8Value()));

        if (index >= 0 && index < size()) {
            Arr::remove(index);
        }
    }
}}

void Queue::swap(const CallbackInfo& info) {
    if (info.Length() >= 2) {
        Arr::swap(info[0].ToNumber(), info[1].ToNumber());
    }
}

void Queue::move(const CallbackInfo& info) {
    if (info.Length() >= 2) {
        Arr::move(info[0].ToNumber(), info[1].ToNumber());
    }
}

Napi::Value Queue::get(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() >= 1) {
        int32_t index = info[0].ToNumber();
        if (index >= 0 && index < size()) {
            return Arr::getUnchecked(index).toObject(env);
        }
    }

    return env.Undefined();
}

void Queue::set(const CallbackInfo& info) {
    if (info.Length() >= 2) {
        int32_t index = info[0].ToNumber();
        if (index >= 0 && index < size()) {
            auto p = info[1];
            if (p.IsString()) {
                auto obj = Arr::getUnchecked(index);

                Arr::setUnchecked(index, Track(File(p.ToString().Utf8Value())));
            } else {
                Arr::setUnchecked(index, Track::fromJS(p));
            }
        }
    }
}

Napi::Value Queue::toArray(const CallbackInfo& info) {
    auto env = info.Env();

    auto result = Napi::Array::New(env, size());
    for (auto index = 0; index < size(); index++) {
        result[index] = Arr::getUnchecked(index).toObject(env);
    }

    return result;
}