#pragma once

#include <napi.h>
#include "Medley.h"

class Track : public medley::ITrack {
public:
    Track()
    {

    }

    Track(const File& file)
        : file(file)
    {

    }

    Track(const juce::String& path)
        : Track(File(path))
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

    Track operator=(const Track& other) {
        file = other.file;
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

    Napi::Object toObject(Napi::Env env) {
        auto obj = Napi::Object::New(env);
        obj.Set("path", Napi::String::New(env, file.getFullPathName().toStdString()));
        return obj;
    }

    static Track fromJS(const Napi::Value p) {
        juce::String path;

        if (p.IsObject()) {
            auto obj = p.ToObject();

            path = obj.Get("path").ToString().Utf8Value();
        } else {
            path = p.ToString().Utf8Value();
        }

        return Track(juce::String(path));
    }

private:
    File file;
};
