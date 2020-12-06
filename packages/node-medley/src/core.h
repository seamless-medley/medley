#pragma once

#include <napi.h>
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
};

class Medley : public ObjectWrap<Medley> {
public:
    using Engine = medley::Medley;

    static void Initialize(Object& exports);

    static void Medley::shutdown(const CallbackInfo& info);

    static void workerFinalizer(const CallbackInfo&);

    Medley(const CallbackInfo& info);

    ~Medley();

    void play(const CallbackInfo& info);

private:
    ObjectReference queueJS;
    Queue* queue;
    Engine* engine;
};
