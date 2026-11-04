#pragma once

#include <napi.h>
#include <map>
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

    File getFile() override {
        return file;
    }

    std::optional<medley::TrackVariation> getVariation(const juce::String& name) override {
        auto it = variations.find(name);
        return it != variations.end() ? std::optional(it->second) : std::nullopt;
    }

    juce::StringArray getVariationNames() override {
        juce::StringArray names;
        for (auto& [k, _] : variations) names.add(k);
        return names;
    }

    void addVariation(const juce::String& name, const medley::TrackVariation& v) {
        variations[name] = v;
    }

    double getCueInPosition() override {
        return cueIn;
    }

    double getCueOutPosition() override {
        return cueOut;
    }

    bool getDisableNextTrackLeadIn() override {
        return disableNextLeadIn;
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

        auto disableNextLeadIn = ref.Get("disableNextLeadIn");
        if (!disableNextLeadIn.IsUndefined() && !disableNextLeadIn.IsNull()) {
            this->disableNextLeadIn = disableNextLeadIn.ToBoolean().Value();
        }

        auto variationsVal = ref.Get("variations");
        if (variationsVal.IsObject()) {
            auto variationsObj = variationsVal.ToObject();
            auto names = variationsObj.GetPropertyNames();
            for (uint32_t i = 0; i < names.Length(); i++) {
                auto key = names.Get(i).ToString().Utf8Value();
                auto entry = variationsObj.Get(key);

                if (!entry.IsObject()) {
                    continue;
                }

                auto entryObj = entry.ToObject();

                medley::TrackVariation v;
                v.file = juce::File(entryObj.Get("path").ToString().Utf8Value());

                auto offset = entryObj.Get("offsetSeconds");
                if (!offset.IsUndefined() && !offset.IsNull()) {
                    v.offsetSeconds = offset.ToNumber().DoubleValue();
                }

                auto gain = entryObj.Get("gainDb");
                if (!gain.IsUndefined() && !gain.IsNull()) {
                    v.gainDb = gain.ToNumber().FloatValue();
                }

                variations[juce::String(key)] = v;
            }
        }
    }

    Napi::ObjectReference ref;
    File file;
    double cueIn = -1.0;
    double cueOut = -1.0;
    bool disableNextLeadIn = false;
    std::map<juce::String, medley::TrackVariation> variations;
};
