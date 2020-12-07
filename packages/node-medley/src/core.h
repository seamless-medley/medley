#pragma once

#include <napi.h>
#include "Medley.h"
#include "queue.h"

using namespace Napi;

class Track : public medley::ITrack {
public:
    Track()
    {

    }

    Track(juce::String& path)
        : file(path)
    {

    }

    Track(File& file)
        : file(file)
    {

    }

    Track(const Track& other)
        : file(other.file)
    {

    }

    Track(Track&& other)
        : file(std::move(other.file))
    {

    }

    File getFile() {
        return file;
    }

private:
    File file;
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

    void stop(const CallbackInfo& info);

private:
    ObjectReference queueJS;
    Queue* queue;
    Engine* engine;

    Reference<Napi::Value> self;
};
