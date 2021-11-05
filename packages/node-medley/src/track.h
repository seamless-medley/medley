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
        createFileObject();
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
    void createFileObject() {
        file = ref.Get("path").ToString().Utf8Value();
    }

    File file;
    Napi::ObjectReference ref;
};
