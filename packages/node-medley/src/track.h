#pragma once

#include <napi.h>
#include "Medley.h"

class Track : public medley::ITrack {
public:
    Track()
    {

    }

    Track(const File& file, float preGain = 1.0f)
        : file(file), preGain(preGain)
    {

    }

    Track(const juce::String& path, float preGain = 1.0f)
        : Track(File(path), preGain)
    {

    }

    Track(const Track& other)
        : file(other.file), preGain(other.preGain)
    {

    }

    Track(Track&& other)
        : file(std::move(other.file)), preGain(other.preGain)
    {

    }

    Track operator=(const Track& other) {
        file = other.file;
        preGain = other.preGain;
        return *this;
    }

    bool operator== (const Track& other) const {
        return file == other.file;
    }

    bool operator!= (const Track& other) const {
        return file != other.file;
    }

    File getFile() {
        return file;
    }

    float getPreGain() const { return preGain; }

    Napi::Object toObject(Napi::Env env) {
        auto obj = Napi::Object::New(env);
        obj.Set("path", Napi::String::New(env, file.getFullPathName().toStdString()));
        obj.Set("preGain", Napi::Number::New(env, preGain));
        return obj;
    }

    static Track fromJS(const Napi::Value p) {
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

private:
    File file;
    float preGain = 1.0f;
};
