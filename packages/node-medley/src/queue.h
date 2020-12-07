#pragma once

#include <napi.h>
#include "track.h"

using namespace Napi;

class Queue : public ObjectWrap<Queue>, public juce::Array<Track>, public medley::IQueue {
public:
    using Arr = Array<Track>;

    static void Initialize(Object& exports);
    static FunctionReference ctor;

    Queue(const CallbackInfo& info)
        : ObjectWrap<Queue>(info)
    {

    }

    size_t count() const {
        return size();
    }

    medley::ITrack::Ptr fetchNextTrack();

    void add(const CallbackInfo& info);

    Napi::Value length(const CallbackInfo& info) {
        return Number::New(info.Env(), count());
    }
};
