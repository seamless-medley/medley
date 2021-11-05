#pragma once

#include <napi.h>
#include "track.h"

using namespace Napi;

class Queue : public ObjectWrap<Queue>, public juce::Array<Track::Ptr>, public medley::IQueue {
public:
    using Arr = juce::Array<Track::Ptr>;

    static void Initialize(Object& exports);
    static FunctionReference ctor;

    Queue(const CallbackInfo& info);

    size_t count() const {
        return size();
    }

    medley::ITrack::Ptr fetchNextTrack();

    void add(const CallbackInfo& info);

    void clear(const CallbackInfo& info);

    Napi::Value isEmpty(const CallbackInfo& info);

    void insert(const CallbackInfo& info);

    void del(const CallbackInfo& info);

    void swap(const CallbackInfo& info);

    void move(const CallbackInfo& info);

    Napi::Value get(const CallbackInfo& info);

    void set(const CallbackInfo& info);

    Napi::Value toArray(const CallbackInfo& info);

    Napi::Value length(const CallbackInfo& info) {
        return Number::New(info.Env(), count());
    }
};
