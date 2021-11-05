#pragma once

#include <napi.h>
#include "Medley.h"

class Track : public medley::ITrack {
public:
    using Ptr = ReferenceCountedObjectPtr<Track>;

    Track()
        : ref(Napi::ObjectReference())
    {

    }

    ~Track() {

    }

    Track(const Napi::Object& obj)
        : ref(Napi::Persistent(obj))
    {
        initFromJS();
    }

    bool operator== (const Track& other) const {
        return ref == other.ref;
    }

    bool operator!= (const Track& other) const {
        return ref != other.ref;
    }

    File getFile() {
        return file;
    }

    double getCueInPosition() override {
        return cueIn;
    }

    double getCueOutPosition() override {
        return cueOut;
    }

    inline Napi::ObjectReference& getObjectRef() {
        return ref;
    }

    inline Napi::Object toObject(Napi::Env env) {
        return ref.Value();
    }

    static Track::Ptr fromJS(const Napi::Value p) {
        Napi::Object obj;

        if (p.IsObject()) {
            obj = p.ToObject();
        } else {
            obj = Napi::Object::New(p.Env());
            obj.Set("path", Napi::String::New(p.Env(), p.ToString().Utf8Value()));
        }

        return new Track(obj);
    }

private:
    void initFromJS() {
        file = ref.Get("path").ToString().Utf8Value();

        auto cueInPosition = ref.Get("cueInPosition");
        if (!cueInPosition.IsUndefined() && !cueInPosition.IsNull()) {
            cueIn = cueInPosition.ToNumber().DoubleValue();
        }

        auto cueOutPosition = ref.Get("cueOutPosition");
        if (!cueOutPosition.IsUndefined() && !cueOutPosition.IsNull()) {
            cueOut = cueOutPosition.ToNumber().DoubleValue();
        }
    }

    Napi::ObjectReference ref;
    File file;
    double cueIn = -1.0;
    double cueOut = -1.0;
};
