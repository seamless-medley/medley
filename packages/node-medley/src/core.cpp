#include "core.h"

using namespace std::chrono_literals;

namespace {
    Napi::Value safeString(Napi::Env env, juce::String s) {
        return s.isNotEmpty() ? Napi::String::New(env, s.toRawUTF8()) : env.Undefined();
    }

    Napi::Object createJSMetadata(Napi::Env env, medley::Metadata metadata) {
        auto result = Object::New(env);

        result.Set("title", safeString(env, metadata.getTitle()));
        result.Set("artist", safeString(env, metadata.getArtist()));
        result.Set("album", safeString(env, metadata.getAlbum()));
        result.Set("isrc", safeString(env, metadata.getISRC()));
        result.Set("albumArtist", safeString(env, metadata.getAlbumArtist()));
        result.Set("originalArtist", safeString(env, metadata.getOriginalArtist()));

        auto trackGain = metadata.getTrackGain();
        auto bpm = metadata.getBeatsPerMinute();

        result.Set("trackGain", trackGain != 0.0f ? Napi::Number::New(env, trackGain) : env.Undefined());
        result.Set("bpm", bpm != 0.0f ? Napi::Number::New(env, bpm) : env.Undefined());

        auto& metacomments = metadata.getComments();

        auto comments = Napi::Array::New(env);
        for (int i = 0; i < (int)metacomments.size(); i++) {
            auto& comment = metacomments.at(i);

            auto pair = Napi::Array::New(env);

            pair.Set((uint32_t)0, safeString(env, comment.first));
            pair.Set((uint32_t)1, safeString(env, comment.second));

            comments.Set(i, pair);
        }

        result.Set("comments", comments);

        return result;
    }

    void readAudioProperties(juce::String trackFile, Object& result) {
        medley::Metadata::AudioProperties audProps(trackFile);

        auto channels = audProps.getChannels();
        auto bitrate = audProps.getBitrate();
        auto sampleRate = audProps.getSampleRate();
        auto duration = audProps.getDuration();

        auto env = result.Env();

        result.Set("channels", channels != 0 ? Napi::Number::New(env, channels) : env.Undefined());
        result.Set("bitrate", bitrate != 0 ? Napi::Number::New(env, bitrate) : env.Undefined());
        result.Set("sampleRate", sampleRate != 0 ? Napi::Number::New(env, sampleRate) : env.Undefined());
        result.Set("duration", duration != 0.0f ? Napi::Number::New(env, duration) : env.Undefined());
    }

}

void Medley::Initialize(Object& exports) {
    auto proto = {
        InstanceMethod<&Medley::getAvailableDevices>("getAvailableDevices"),
        InstanceMethod<&Medley::setAudioDevice>("setAudioDevice"),
        InstanceMethod<&Medley::getAudioDevice>("getAudioDevice"),
        InstanceMethod<&Medley::play>("play"),
        InstanceMethod<&Medley::stop>("stop"),
        InstanceMethod<&Medley::togglePause>("togglePause"),
        InstanceMethod<&Medley::fadeOut>("fadeOut"),
        InstanceMethod<&Medley::seek>("seek"),
        InstanceMethod<&Medley::seekFractional>("seekFractional"),
        InstanceMethod<&Medley::getDeckMetadata>("getDeckMetadata"),
        InstanceMethod<&Medley::getDeckPositions>("getDeckPositions"),
        //
        InstanceMethod<&Medley::requestAudioStream>("*$reqAudio"),
        InstanceMethod<&Medley::reqAudioGetSamplesReady>("*$reqAudio$getSamplesReady"),
        InstanceMethod<&Medley::reqAudioConsume>("*$reqAudio$consume"),
        InstanceMethod<&Medley::updateAudioStream>("updateAudioStream"),
        InstanceMethod<&Medley::reqAudioGetlatency>("*$reqAudio$getLatency"),
        InstanceMethod<&Medley::reqAudioDispose>("*$reqAudio$dispose"),
        InstanceMethod<&Medley::reqAudioGetFx>("*$reqAudio$getFx"),
        InstanceMethod<&Medley::reqAudioSetFx>("*$reqAudio$setFx"),

        InstanceMethod<&Medley::getFx>("getFx"),
        InstanceMethod<&Medley::setFx>("setFx"),
        //
        InstanceAccessor<&Medley::level>("level"),
        InstanceAccessor<&Medley::reduction>("reduction"),
        InstanceAccessor<&Medley::playing>("playing"),
        InstanceAccessor<&Medley::paused>("paused"),
        InstanceAccessor<&Medley::getVolume, &Medley::setVolume>("volume"),
        InstanceAccessor<&Medley::getFadingCurve, &Medley::setFadingCurve>("fadingCurve"),
        InstanceAccessor<&Medley::getMinimumLeadingToFade, &Medley::setMinimumLeadingToFade>("minimumLeadingToFade"),
        InstanceAccessor<&Medley::getMaximumFadeOutDuration, &Medley::setMaximumFadeOutDuration>("maximumFadeOutDuration"),
        InstanceAccessor<&Medley::getReplayGainBoost, &Medley::setReplayGainBoost>("replayGainBoost"),
        //
        StaticMethod<&Medley::static_getMetadata>("getMetadata"),
        StaticMethod<&Medley::static_getAudioProperties>("getAudioProperties"),
        StaticMethod<&Medley::static_getCoverAndLyrics>("getCoverAndLyrics"),
        StaticMethod<&Medley::static_isTrackLoadable>("isTrackLoadable"),
        StaticMethod<&Medley::static_getInfo>("$getInfo"),
    };

    auto env = exports.Env();
    exports.Set("Medley", DefineClass(env, "Medley", proto));
}

Medley::Medley(const CallbackInfo& info)
    : ObjectWrap<Medley>(info)
{
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return;
    }

    auto arg1 = info[0];
    if (!arg1.IsObject()) {
        TypeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return;
    }

    auto queueObj = arg1.ToObject();

    if (!queueObj.InstanceOf(Queue::ctor.Value())) {
        TypeError::New(env, "Is not a queue").ThrowAsJavaScriptException();
        return;
    }

    bool logging = false;
    bool skipDeviceScanning = false;

    auto arg2 = info[1];
    if (arg2.IsObject()) {
        auto options = arg2.ToObject();
        if (options.Has("logging")) {
            auto l = options.Get("logging");
            if (l.IsBoolean()) {
                logging = l.ToBoolean().Value();
            }
        }

        if (options.Has("skipDeviceScanning")) {
            auto l = options.Get("skipDeviceScanning");
            if (l.IsBoolean()) {
                skipDeviceScanning = l.ToBoolean().Value();
            }
        }
    }

    self = Persistent(info.This());
    queueJS = Persistent(queueObj);

    try {
        threadSafeEmitter = ThreadSafeFunction::New(
            env, info.This().ToObject().Get("emit").As<Function>(),
            "Medley Emitter",
            0, 1
        );

        queue = Queue::Unwrap(queueObj);
        engine = new Engine(*queue, logging ? this : nullptr, skipDeviceScanning);
        engine->addListener(this);
        engine->setAudioCallback(this);
    }
    catch (std::exception const& e) {
        throw Napi::Error::New(info.Env(), e.what());
    }
    catch (...) {
        throw Napi::Error::New(info.Env(), "Unknown Error while initializing engine.");
    }
}

Medley::~Medley() {
    delete engine;
    delete queue;
}

Napi::Value Medley::getAvailableDevices(const CallbackInfo& info) {
    auto env = info.Env();
    auto result = Napi::Array::New(env);

    auto currentType = engine->getCurrentAudioDeviceType();
    auto currentDevice = engine->getCurrentAudioDevice();

    auto& deviceTypes = engine->getAvailableDeviceTypes();

    for (auto typeIndex = 0; typeIndex < deviceTypes.size(); typeIndex++) {
        auto type = deviceTypes[typeIndex];
        auto desc = Object::New(env);

        {
            auto names = type->getDeviceNames(false);
            auto devices = Napi::Array::New(env);

            for (auto i = 0; i < names.size(); i++) {
                devices.Set(i, names[i].toStdString());
            }

            desc.Set("type", type->getTypeName().toStdString());
            desc.Set("isCurrent", currentType == type);
            desc.Set("devices", devices);
            desc.Set("defaultDevice", devices.Get(type->getDefaultDeviceIndex(false)));

            if (currentDevice && currentDevice->getTypeName() == type->getTypeName()) {
                desc.Set("currentDevice", currentDevice->getName().toStdString());
            }
        }

        result.Set(typeIndex, desc);
    }

    return result;
}

Napi::Value Medley::setAudioDevice(const CallbackInfo& info) {
    auto env = info.Env();
    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return Boolean::From(env, false);
    }

    auto desc = info[0].ToObject();
    if (desc.Has("type")) {
        engine->setCurrentAudioDeviceType(juce::String(desc.Get("type").ToString().Utf8Value()));
    }

    if (desc.Has("device")) {
        auto name = juce::String(desc.Get("device").ToString().Utf8Value());
        auto index = engine->getDeviceNames().indexOf(name);

        if (index == -1) {
            return Boolean::From(env, false);
        }
    }

    return Boolean::From(env, engine->getCurrentAudioDevice() != nullptr);
}

Napi::Value Medley::getAudioDevice(const CallbackInfo& info) {
    auto env = info.Env();

    auto device = engine->getCurrentAudioDevice();

    if (device == nullptr) {
        return env.Undefined();
    }

    auto desc = Object::New(env);
    desc.Set("type", device->getTypeName().toStdString());
    desc.Set("device", device->getName().toStdString());
    return desc;
}

void Medley::deckTrackScanning(medley::Deck& sender) {

}

void Medley::deckTrackScanned(medley::Deck& sender) {

}

void Medley::deckPosition(medley::Deck& sender, double position) {

}

void Medley::deckStarted(medley::Deck& sender, medley::TrackPlay& track) {
    emitDeckEvent("started", sender, track);
}

void Medley::deckFinished(medley::Deck& sender, medley::TrackPlay& track) {
    emitDeckEvent("finished", sender, track);
}

void Medley::deckLoaded(medley::Deck& sender, medley::TrackPlay& track) {
    emitDeckEvent("loaded", sender, track);
}

void Medley::deckUnloaded(medley::Deck& sender, medley::TrackPlay& track) {
    emitDeckEvent("unloaded", sender, track);
}

void Medley::mainDeckChanged(medley::Deck& sender, medley::TrackPlay& track) {
    emitDeckEvent("mainDeckChanged", sender, track);
}

void Medley::audioDeviceChanged() {
    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function fn) {
        fn.Call(self.Value(), { Napi::String::New(env, "audioDeviceChanged") });
    });
}

void Medley::log(medley::LogLevel level, juce::String& name, juce::String& msg) const {
    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function emitFn) {
        try {
            emitFn.Call(self.Value(), {
                Napi::String::New(env, "log"),
                Napi::Number::New(env, static_cast<int8_t>(level)),
                Napi::String::New(env, name.toRawUTF8()),
                Napi::String::New(env, msg.toRawUTF8())
            });
        } catch (...) {

        }
    });
}

/**
 * Called from Medley
 */
void Medley::enqueueNext(EnqueueNextDone done) {
    // Emit enqueueNext event to JS, propagate the result back to Medley via `done` function
    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function emitFn) {
        try {
            auto callback = Napi::Function::New(env, [done](const CallbackInfo &cbInfo) {
                done(cbInfo.Length() > 0 ? cbInfo[0].ToBoolean() : false);
            });

            emitFn.Call(self.Value(), { Napi::String::New(env, "enqueueNext"), callback });
        } catch (...) {
            done(false);
        }
    });
}

void Medley::emitDeckEvent(const std::string& name,  medley::Deck& deck, medley::TrackPlay& trackPlay) {
    auto index = deck.getIndex();

    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function emitFn) {
        try {
            auto uuid = trackPlay.getUuid().toDashedString();
            auto track = static_cast<Track*>(trackPlay.getTrack().get())->getObjectRef().Value();

            auto obj = Napi::Object::New(env);
            obj.Set("uuid", Napi::String::New(env, uuid.toStdString()));
            obj.Set("track", track);
            obj.Set("duration", trackPlay.getDuration());

            emitFn.Call(self.Value(), {
                Napi::String::New(env, name),
                Napi::Number::New(env, index),
                obj
            });
        }
        catch (...) {
            // To survive any exceptions raised from C++ land
        }
    });
}

Napi::Value Medley::play(const CallbackInfo& info) {
    bool shouldFade = true;
    if (info.Length() > 0) {
        shouldFade = info[0].ToBoolean();
    }

    auto result = engine->play(shouldFade);
    return Napi::Boolean::New(info.Env(), result);
}

void Medley::stop(const CallbackInfo& info) {
    bool shouldFade = true;
    if (info.Length() > 0) {
        shouldFade = info[0].ToBoolean();
    }

    engine->stop(shouldFade);
}

Napi::Value Medley::togglePause(const CallbackInfo& info) {
    bool fade = true;

    if (info.Length() > 0) {
        fade = info[0].ToBoolean();
    }

    return Napi::Boolean::New(info.Env(), engine->togglePause(fade));
}

Napi::Value Medley::fadeOut(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->fadeOutMainDeck());
}

void Medley::seek(const CallbackInfo& info) {
    int deckIndex = -1;
    if (info.Length() > 1) {
        if (info[1].IsNumber()) {
            deckIndex = (int)info[1].ToNumber() & 3;
        }
    }

    engine->setPosition(info[0].ToNumber().DoubleValue(), deckIndex);
}

void Medley::seekFractional(const CallbackInfo& info) {
    int deckIndex = -1;
    if (info.Length() > 1) {
        if (info[1].IsNumber()) {
            deckIndex = (int)info[1].ToNumber() & 3;
        }
    }

    engine->setPositionFractional(info[0].ToNumber().DoubleValue(), deckIndex);
}

Napi::Value Medley::level(const CallbackInfo& info) {
    auto env = info.Env();

    auto left = Object::New(env);
    left.Set("magnitude", Number::New(env, engine->getLevel(0)));
    left.Set("peak", Number::New(env, engine->getPeakLevel(0)));

    auto right = Object::New(env);
    right.Set("magnitude", Number::New(env, engine->getLevel(1)));
    right.Set("peak", Number::New(env, engine->getPeakLevel(1)));

    auto result = Object::New(env);
    result.Set("left", left);
    result.Set("right", right);

    return result;
}

Napi::Value Medley::reduction(const CallbackInfo& info) {
    auto env = info.Env();

    return Number::New(env, (double)engine->getReduction());
}

Napi::Value Medley::playing(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->isPlaying());
}

Napi::Value Medley::paused(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->isPaused());
}

Napi::Value Medley::getVolume(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getVolume());
}

void Medley::setVolume(const CallbackInfo& info, const Napi::Value& value) {
    engine->setVolume(value.ToNumber().DoubleValue());
}

Napi::Value Medley::getFadingCurve(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getFadingCurve());
}

void Medley::setFadingCurve(const CallbackInfo& info, const Napi::Value& value) {
    engine->setFadingCurve(value.ToNumber().DoubleValue());
}

Napi::Value Medley::getMinimumLeadingToFade(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getMinimumLeadingToFade());
}

void Medley::setMinimumLeadingToFade(const CallbackInfo& info, const Napi::Value& value) {
    engine->setMinimumLeadingToFade(value.ToNumber().DoubleValue());
}

Napi::Value Medley::getMaximumFadeOutDuration(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getMaximumFadeOutDuration());
}

void Medley::setMaximumFadeOutDuration(const CallbackInfo& info, const Napi::Value& value) {
    engine->setMaximumFadeOutDuration(value.ToNumber().DoubleValue());
}

Napi::Value Medley::getReplayGainBoost(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getReplayGainBoost());
}

void Medley::setReplayGainBoost(const CallbackInfo& info, const Napi::Value& value) {
    engine->setReplayGainBoost(value.ToNumber().FloatValue());
}

Napi::Value Medley::getDeckMetadata(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        RangeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto arg1 = info[0];
    if (!arg1.IsNumber()) {
        RangeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto index = arg1.ToNumber().Int32Value();
    if (index < 0 || index >= engine->numDecks) {
        RangeError::New(env, "Invalid deck " + std::to_string(index)).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto& deck = (index == 0) ? engine->getDeck1() : (index == 1 ? engine->getDeck2() : engine->getDeck3());

    if (!deck.isTrackLoaded()) {
        return env.Undefined();
    }

    auto metadata = deck.metadata();
    return createJSMetadata(env, metadata);
}

Napi::Value Medley::getDeckPositions(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        RangeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto arg1 = info[0];
    if (!arg1.IsNumber()) {
        RangeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto index = arg1.ToNumber().Int32Value();
    if (index < 0 || index >= engine->numDecks) {
        RangeError::New(env, "Invalid deck " + std::to_string(index)).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto& deck = (index == 0) ? engine->getDeck1() : (index == 1 ? engine->getDeck2() : engine->getDeck3());
    auto nextDeck = engine->getNextDeck(&deck);

    auto sr = deck.getSourceSampleRate();
    auto first = deck.getFirstAudiblePosition();
    auto last = deck.getEndPosition();

    auto leading = deck.getLeadingSamplePosition() / sr;
    auto trailing = deck.getTrailingSamplePosition() / sr;

    auto nextLeading = (float)((nextDeck != nullptr && nextDeck->isTrackLoaded() && !nextDeck->isMain()) ? nextDeck->getLeadingDuration() : 0);
    auto cuePoint = deck.getTransitionCuePosition();
    auto transitionStart = (float)deck.getTransitionStartPosition() - nextLeading;
    auto transitionEnd = (float)deck.getTransitionEndPosition();

    auto result = Object::New(env);
    result.Set("current", deck.getPosition());
    result.Set("duration", deck.getDuration());
    result.Set("first", first);
    result.Set("last", last);
    result.Set("leading", leading);
    result.Set("trailing", trailing);
    result.Set("cuePoint", cuePoint);
    result.Set("transitionStart", transitionStart);
    result.Set("transitionEnd", transitionEnd);

    return result;
}

void Medley::audioDeviceUpdate(juce::AudioIODevice* device, const medley::Medley::AudioDeviceConfig& config) {
    auto numSamples = device->getCurrentBufferSizeSamples();
    auto numChannels = device->getOutputChannelNames().size();

    int latencyInSamples = engine->getOutputLatency();
    ProcessSpec audioSpec{ config.sampleRate, (uint32)numSamples, (uint32)numChannels };

    for (auto& [id, req] : audioRequests) {
        req->processor->prepare(audioSpec, latencyInSamples);
    }
}

void Medley::audioData(const AudioSourceChannelInfo& originalInfo, double timestamp) {
    for (auto& [id, req] : audioRequests) {
        AudioBuffer<float> buffer(originalInfo.buffer->getNumChannels(), originalInfo.buffer->getNumSamples());

        for (int i = originalInfo.buffer->getNumChannels(); --i >= 0;) {
            buffer.copyFrom(i, 0, originalInfo.buffer->getReadPointer(i), originalInfo.buffer->getNumSamples());
        }

        AudioSourceChannelInfo info(&buffer, originalInfo.startSample, originalInfo.numSamples);
        req->processor->process(info, timestamp);

        req->buffer.write(*info.buffer, info.startSample, info.numSamples);
    }
}

namespace {
    typedef struct {
        char* name;
        DeFXKaraoke::Param param;
    } ParamMap;

    ParamMap paramsMap[] = {
        { (char*)"mix",            DeFXKaraoke::Param::Mix },
        { (char*)"lowpassCutoff",  DeFXKaraoke::Param::LowPassCutOff },
        { (char*)"lowpassQ",       DeFXKaraoke::Param::LowPassQ },
        { (char*)"highpassCutoff", DeFXKaraoke::Param::HighPassCutOff },
        { (char*)"highpassQ",      DeFXKaraoke::Param::HighPassQ }
    };
}

Napi::Object Medley::getKaraokeParams(KaraokeParamController& ctrl, const CallbackInfo& info) {
    auto result = Object::New(info.Env());
    result.Set("enabled", ctrl.isKaraokeEnabled());

    for (auto& p : ::paramsMap) {
        result.Set(p.name, ctrl.getKaraokeParams(p.param));
    }

    return result;
}

void Medley::setKaraokeParams(KaraokeParamController& ctrl, const Napi::Object& params) {
    for (auto& p : ::paramsMap) {
        if (params.Has(p.name)) {
            ctrl.setKaraokeParams(p.param, params.Get(p.name).ToNumber().FloatValue());
        }
    }

    if (params.Has("enabled")) {
        bool enabled = params.Get("enabled").ToBoolean();
        bool dontTransit = false;

        if (params.Has("dontTransit")) {
            auto p = params.Get("dontTransit");

            if (!p.IsUndefined()) {
                dontTransit = p.ToBoolean();
            }
        }

        ctrl.setKaraokeEnabled(enabled, dontTransit);
    }
}

Napi::Value Medley::requestAudioStream(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto options = info[0].ToObject();
    auto format = options.Get("format").ToString();
    auto formatStr = juce::String(format.ToString().Utf8Value());
    auto validFormats = juce::StringArray("Int16LE", "Int16BE", "FloatLE", "FloatBE");
    auto formatIndex = validFormats.indexOf(formatStr);

    if (!format.IsString() || formatIndex == -1) {
        TypeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto audioFormat = static_cast<AudioRequestFormat>(formatIndex);

    auto device = engine->getCurrentAudioDevice();
    auto numChannels = device->getOutputChannelNames().size();
    auto sampleRate = engine->getOutputSampleRate();

    auto requestedSampleRate = options.Has("sampleRate") ? options.Get("sampleRate") : env.Undefined();
    auto outSampleRate = (!requestedSampleRate.IsNull() && !requestedSampleRate.IsUndefined()) ? requestedSampleRate.ToNumber().DoubleValue() : sampleRate;

    uint32_t bufferSize = (uint32_t)(sampleRate * 0.25f);
    {
        auto jsValue = options.Get("bufferSize");
        if (jsValue.IsNumber()) {
            auto value = jsValue.ToNumber().Uint32Value();
            if (value > 0) {
                bufferSize = value;
            }
        }
    }

    auto gainJS = options.Has("gain") ? options.Get("gain") : env.Undefined();
    auto gain = (!gainJS.IsNull() && !gainJS.IsUndefined()) ? gainJS.ToNumber().FloatValue() : 1.0f;
    auto fx = options.Has("fx") ? options.Get("fx") : env.Undefined();

    auto request = registerAudioRequest(
        audioRequestId,
        audioFormat,
        outSampleRate,
        bufferSize,
        gain,
        fx
    );

    auto result = Object::New(env);
    //
    result.Set("id", audioRequestId++);
    result.Set("channels", numChannels);
    result.Set("bitPerSample", request->outputBytesPerSample * 8);
    result.Set("originalSampleRate", sampleRate);
    result.Set("sampleRate", outSampleRate);
    //
    return result;
}

std::shared_ptr<audio_req::AudioRequest> Medley::registerAudioRequest(uint32_t id, AudioRequestFormat audioFormat, double outSampleRate, uint32_t bufferSize, float gain, Napi::Value fx) {
    auto audioConveter = audioConverters.find(audioFormat);
    if (audioConveter == audioConverters.end()) {
        switch (audioFormat) {
            case AudioRequestFormat::FloatLE:
                audioConverters[audioFormat] = std::make_shared<AudioData::ConverterInstance<NativeAudioFormat, Float32LittleEndianFormat>>(1, 2);
                break;
            case AudioRequestFormat::FloatBE:
                audioConverters[audioFormat] = std::make_shared<AudioData::ConverterInstance<NativeAudioFormat, Float32BigEndianFormat>>(1, 2);
                break;
            case AudioRequestFormat::Int16LE:
                audioConverters[audioFormat] = std::make_shared<AudioData::ConverterInstance<NativeAudioFormat, Int16LittleEndianFormat>>(1, 2);
                break;
            case AudioRequestFormat::Int16BE:
                audioConverters[audioFormat] = std::make_shared<AudioData::ConverterInstance<NativeAudioFormat, Int16BigEndianFormat>>(1, 2);
                break;

            default:
                return nullptr;
        }
    }

    uint8_t bytesPerSample = 0;

    switch (audioFormat) {
        case AudioRequestFormat::FloatLE:
        case AudioRequestFormat::FloatBE:
            bytesPerSample = 4;
            break;
        case AudioRequestFormat::Int16LE:
        case AudioRequestFormat::Int16BE:
            bytesPerSample = 2;
            break;
    }

    auto config = engine->getAudioDeviceSetup();
    auto device = engine->getCurrentAudioDevice();
    auto numSamples = device->getCurrentBufferSizeSamples();
    auto numChannels = device->getOutputChannelNames().size();
    auto deviceSampleRate = device->getCurrentSampleRate();

    auto outputSampleRate = engine->getOutputSampleRate();
    int latencyInSamples = engine->getOutputLatency();

    if (bufferSize == 0) {
        bufferSize = (uint32_t)(outputSampleRate * 0.25f);
    }

    std::shared_ptr<PostProcessor> processor = std::make_shared<PostProcessor>();
    ProcessSpec audioSpec{ config.sampleRate, (uint32)numSamples, (uint32)numChannels };

    processor->prepare(audioSpec, latencyInSamples);

    if (fx.IsObject()) {
        auto fxObj = fx.ToObject();
        if (fxObj.Has("karaoke")) {
            auto karaokeParam = fxObj.Get("karaoke");
            if (karaokeParam.IsObject()) {
                setKaraokeParams(*processor.get(), karaokeParam.ToObject());
            }
        }
    }

    auto request = std::make_shared<audio_req::AudioRequest>(
        id,
        bufferSize,
        numChannels,
        deviceSampleRate,
        outSampleRate,
        bytesPerSample,
        audioConverters[audioFormat],
        processor,
        gain
    );

    audioRequests.emplace(id, request);
    return request;
}

Napi::Value Medley::reqAudioConsume(const CallbackInfo& info) {
    auto env = info.Env();

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());
    auto size = info[1].As<Number>().Int64Value();

    auto it = audioRequests.find(streamId);
    if (it == audioRequests.end()) {
        return env.Null();
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    auto consumer = new audio_req::AudioConsumer(it->second, size, deferred);
    consumer->Queue();

    return deferred.Promise();
}

Napi::Value Medley::reqAudioGetSamplesReady(const CallbackInfo& info) {
    auto env = info.Env();

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());

    auto it = audioRequests.find(streamId);
    if (it == audioRequests.end()) {
        return env.Undefined();
    }

    return Number::New(env, it->second->buffer.getNumReady());
}

Napi::Value Medley::updateAudioStream(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());
    auto options = info[1].ToObject();

    auto it = audioRequests.find(streamId);
    if (it == audioRequests.end()) {
        return Boolean::New(env, false);
    }

    auto& request = it->second;

    if (options.Has("gain")) {
        auto newGain = options.Get("gain").ToNumber().FloatValue();
        //
        auto startTime = request->currentTime + 100;
        auto endTime = startTime + 1000;

        request->fader.start(startTime, endTime, request->preferredGain, newGain, 2.0f, newGain);
        request->preferredGain = newGain;
    }

    if (options.Has("fx")) {
        auto fx = options.Get("fx");

        auto fxObj = fx.ToObject();
        if (fxObj.Has("karaoke")) {
            auto karaokeParam = fxObj.Get("karaoke");
            if (karaokeParam.IsObject()) {
                setKaraokeParams(*request->processor.get(), karaokeParam.ToObject());
            }
        }
    }

    return Boolean::New(env, true);
}

Napi::Value Medley::reqAudioGetlatency(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());
    auto it = audioRequests.find(streamId);
    if (it == audioRequests.end()) {
        return env.Undefined();
    }

    auto& request = it->second;

    auto sampleRate = engine->getOutputSampleRate();
    auto outputLatency = (double)engine->getOutputLatency();
    auto bufferedSize = (double)request->buffer.getNumReady();

    auto latencyMs = outputLatency / sampleRate * 1000;

    return Number::New(env, latencyMs);
}

Napi::Value Medley::reqAudioDispose(const CallbackInfo& info) {
    auto env = info.Env();

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());

    auto it = audioRequests.find(streamId);
    if (it != audioRequests.end()) {
        it->second->running = false;
        audioRequests.erase(it);
        return Boolean::From(env, true);
    }

    return Boolean::From(env, false);
}

Napi::Value Medley::getFx(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto type = juce::String(info[0].ToString().Utf8Value());

    if (type.compareIgnoreCase("karaoke") == 0) {
        return getKaraokeParams(*engine, info);
    }

    TypeError::New(env, "Unknown effect type").ThrowAsJavaScriptException();
    return env.Undefined();
}

Napi::Value Medley::setFx(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 2) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto type = juce::String(info[0].ToString().Utf8Value());
    auto params = info[1].ToObject();

    if (type.compareIgnoreCase("karaoke") == 0) {
        setKaraokeParams(*engine, params);
        return Boolean::From(env, true);
    }

    TypeError::New(env, "Unknown effect type").ThrowAsJavaScriptException();
    return Boolean::From(env, false);
}

Napi::Value Medley::reqAudioGetFx(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 2) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());

    auto it = audioRequests.find(streamId);
    if (it == audioRequests.end()) {
        return env.Undefined();
    }

    auto type = juce::String(info[1].ToString().Utf8Value());

    if (type.compareIgnoreCase("karaoke") == 0) {
        return getKaraokeParams(*it->second->processor, info);
    }

    return env.Undefined();
}

Napi::Value Medley::reqAudioSetFx(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 3) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto streamId = static_cast<uint32_t>(info[0].As<Number>().Int32Value());

    auto it = audioRequests.find(streamId);
    if (it == audioRequests.end()) {
        return env.Undefined();
    }

    auto type = juce::String(info[1].ToString().Utf8Value());

    auto params = info[2].ToObject();

    if (type.compareIgnoreCase("karaoke") == 0) {
        setKaraokeParams(*it->second->processor, params);
        return Boolean::From(env, true);
    }

    TypeError::New(env, "Unknown effect type").ThrowAsJavaScriptException();
    return Boolean::From(env, false);
}

Napi::Value Medley::static_getMetadata(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        RangeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    bool ok = false;
    medley::Metadata metadata;

    try {
        juce::String trackFile = info[0].ToString().Utf8Value();
        ok = metadata.readFromFile(trackFile);
    }
    catch (std::exception const& e) {
        throw Napi::Error::New(info.Env(), e.what());
    }
    catch (...) {
        throw Napi::Error::New(info.Env(), "Error reading file");
    }

    if (!ok) {
        return env.Undefined();
    }

    return createJSMetadata(env, metadata);
}

Napi::Value Medley::static_getAudioProperties(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Object::New(env);

    try {
        juce::String trackFile = info[0].ToString().Utf8Value();
        readAudioProperties(trackFile, result);
    }
    catch (...) {

    }

    return result;
}

Napi::Value Medley::static_getCoverAndLyrics(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Object::New(env);

    try {

        juce::String trackFile = info[0].ToString().Utf8Value();

        medley::Metadata::CoverAndLyrics cal(trackFile, true, true);
        auto cover = cal.getCover();
        auto coverData = cover.getData();

        result.Set("cover", Napi::Buffer<uint8_t>::Copy(env, (uint8_t*)coverData.data(), coverData.size()));
        result.Set("coverMimeType", Napi::String::New(env, cover.getMimeType().toStdString()));
        result.Set("lyrics", Napi::String::New(env, cal.getLyrics().toStdString()));
    }
    catch (...) {

    }

    return result;
}

Napi::Value Medley::static_isTrackLoadable(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return Boolean::New(env, false);
    }

    try {
        auto trackPtr = Track::fromJS(info[0]);
        return Boolean::New(env, medley::utils::isTrackLoadable(supportedFormats, trackPtr));
    }
    catch (...) {
        return Boolean::New(env, false);
    }
}

Napi::Value Medley::static_getInfo(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    auto result = Object::New(env);

    {
        auto runtime = Object::New(env);
        runtime.Set("napiVersion", Napi::Number::New(env, VersionManagement::GetNapiVersion(env)));
        result.Set("runtime", runtime);
    }

    {
        auto versionString = juce::String::formatted(
            "%d.%d.%d",
            MEDLEY_VERSION_MAJOR,
            MEDLEY_VERSION_MINOR,
            MEDLEY_VERSION_PATCH
        );

        auto version = Object::New(env);
        version.Set("major", Napi::Number::New(env, MEDLEY_VERSION_MAJOR));
        version.Set("minor", Napi::Number::New(env, MEDLEY_VERSION_MINOR));
        version.Set("patch", Napi::Number::New(env, MEDLEY_VERSION_PATCH));

#ifdef MEDLEY_VERSION_PRE_RELEASE
        version.Set("prerelease", Napi::String::New(env, MEDLEY_VERSION_PRE_RELEASE));
        versionString += juce::String("-" MEDLEY_VERSION_PRE_RELEASE);
#endif

        result.Set("version", version);
        result.Set("versionString", Napi::String::New(env, versionString.toRawUTF8()));
    }

    {
        auto juce = Object::New(env);

        {
            auto version = Object::New(env);
            version.Set("major", Napi::Number::New(env, JUCE_MAJOR_VERSION));
            version.Set("minor", Napi::Number::New(env, JUCE_MINOR_VERSION));
            version.Set("build", Napi::Number::New(env, JUCE_BUILDNUMBER));

            juce.Set("version", version);
        }
        {
            auto cpu = Object::New(env);

            #if JUCE_INTEL
            cpu.Set("intel", Napi::Boolean::New(env, true));
            #endif

            #if JUCE_USE_SSE_INTRINSICS
            cpu.Set("sse", Napi::Boolean::New(env, true));
            #endif

            #if defined (__aarch64__)
            cpu.Set("aarch64", Napi::Boolean::New(env, true));
            #endif

            #if JUCE_ARM
            cpu.Set("arm", Napi::Boolean::New(env, true));
            #endif

            #if defined (__arm64__)
            cpu.Set("arm64", Napi::Boolean::New(env, true));
            #endif

            #if JUCE_USE_ARM_NEON
            cpu.Set("neon", Napi::Boolean::New(env, true));
            #endif

            #if JUCE_USE_VDSP_FRAMEWORK
            cpu.Set("vdsp", Napi::Boolean::New(env, true));
            #endif

            juce.Set("cpu", cpu);
        }

        result.Set("juce", juce);
    }

    return result;
}

uint32_t Medley::audioRequestId = 0;

Engine::SupportedFormats Medley::supportedFormats;
