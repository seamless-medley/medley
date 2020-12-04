#include <napi.h>
#include <Windows.h>
#include "Medley.h"

using namespace Napi;

class Track : public medley::ITrack {
public:
    Track(File& file)
        :
        file(file)
    {

    }

    File& getFile() override {
        return file;
    }

private:
    JUCE_LEAK_DETECTOR(Track)

    File file;
};

class Queue : public medley::IQueue {
public:
    size_t count() const override {
        return tracks.size();
    }

    medley::ITrack::Ptr fetchNextTrack() {
        auto track = tracks.front();
        tracks.erase(tracks.begin());
        return track;
    }

    std::list<Track::Ptr> tracks;
};

class Medley : public ObjectWrap<Medley> {
public:
    static void Initialize(Object& exports) {
        auto proto = {
            InstanceMethod<&Medley::test>("test")
        };

        exports.Set("Medley", DefineClass(exports.Env(), "Medley", proto));
    }

    Medley(const CallbackInfo& info)
        : ObjectWrap<Medley>(info),
        engine(queue)
    {

    }

    void test(const CallbackInfo& info) {
        std::cout << "Hello test";
    }

    Queue queue;
    medley::Medley engine;
};

Object Init(Env env, Object exports) {
    Medley::Initialize(exports);
    return exports;
}

NODE_API_MODULE(medley, Init)