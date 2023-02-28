#include "core.h"

using namespace std::chrono_literals;

namespace {
    class AudioRequestProcessor : public AsyncWorker {
    public:
        AudioRequestProcessor(std::shared_ptr<Medley::AudioRequest> request, const Napi::Env& env)
            : AsyncWorker(env),
            request(request)
        {

        }

        AudioRequestProcessor(std::shared_ptr<Medley::AudioRequest> request, const Napi::Function& callback)
            : AsyncWorker(callback),
            request(request)
        {

        }

    protected:
        void Process(uint64_t requestedNumSamples) {
            auto outputBytesPerSample = request->outputBytesPerSample;
            auto numChannels = request->numChannels;

            while (request->running && request->buffer.getNumReady() < request->buffering) {
                std::this_thread::sleep_for(5ms);
            }

            request->currentTime = Time::getMillisecondCounterHiRes();

            auto numSamples = jmin((uint64_t)request->buffer.getNumReady(), requestedNumSamples);

            juce::AudioBuffer<float> tempBuffer(numChannels, numSamples);
            request->buffer.read(tempBuffer, numSamples);

            auto gain = request->fader.update(request->currentTime);

            tempBuffer.applyGainRamp(0, numSamples, request->lastGain, gain);
            request->lastGain = gain;

            juce::AudioBuffer<float>* sourceBuffer = &tempBuffer;
            std::unique_ptr<juce::AudioBuffer<float>> resampleBuffer;
            auto outSamples = numSamples;

            if (request->inSampleRate != request->requestedSampleRate)
            {
                outSamples = roundToInt(numSamples * (double)request->requestedSampleRate / (double)request->inSampleRate);
                resampleBuffer = std::make_unique<juce::AudioBuffer<float>>(numChannels, outSamples);

                long used = 0;
                int actualSamples = outSamples;

                for (int i = 0; i < numChannels; i++) {
                    actualSamples = request->resamplers[i]->process(
                        tempBuffer.getReadPointer(i),
                        numSamples,
                        resampleBuffer->getWritePointer(i),
                        outSamples,
                        used
                    );
                }

                sourceBuffer = resampleBuffer.get();
                outSamples = actualSamples;
            }

            bytesReady = outSamples * numChannels * outputBytesPerSample;
            request->scratch.ensureSize(bytesReady);

            for (int i = 0; i < numChannels; i++) {
                request->converter->convertSamples(request->scratch.getData(), i, sourceBuffer->getReadPointer(i), 0, outSamples);
            }
        }

        std::shared_ptr<Medley::AudioRequest> request;
        uint64_t bytesReady = 0;
    };

    class AudioConsumer : public AudioRequestProcessor {
    public:
        AudioConsumer(std::shared_ptr<Medley::AudioRequest> request, uint64_t requestedSize, const Promise::Deferred& deferred)
            :
            AudioRequestProcessor(request, Napi::Function::New(deferred.Env(), [deferred](const CallbackInfo &cbInfo) {
                deferred.Resolve(cbInfo[0]); // cbInfo[0] is the buffer returned from GetResult()
                return cbInfo.Env().Undefined();
            })),
            requestedSize(requestedSize)
        {

        }

        void Execute() override
        {
            Process(requestedSize / request->outputBytesPerSample / request->numChannels);
        }

        std::vector<napi_value> GetResult(Napi::Env env) override {
            auto result = Napi::Buffer<uint8_t>::Copy(env, (uint8_t*)request->scratch.getData(), bytesReady);
            return { result };
        }
    private:
        uint64_t requestedSize;
    };

    Napi::Value safeString(Napi::Env env, juce::String s) {
        return s.isNotEmpty() ? Napi::String::New(env, s.toRawUTF8()) : env.Undefined();
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
        InstanceMethod<&Medley::reqAudioConsume>("*$reqAudio$consume"),
        InstanceMethod<&Medley::updateAudioStream>("updateAudioStream"),
        InstanceMethod<&Medley::reqAudioDispose>("*$reqAudio$dispose"),
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
        StaticMethod<&Medley::static_getCoverAndLyrics>("getCoverAndLyrics"),
        StaticMethod<&Medley::static_isTrackLoadable>("isTrackLoadable"),
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

    auto obj = arg1.ToObject();

    if (!obj.InstanceOf(Queue::ctor.Value())) {
        TypeError::New(env, "Is not a queue").ThrowAsJavaScriptException();
        return;
    }

    self = Persistent(info.This());
    queueJS = Persistent(obj);

    try {
        queue = Queue::Unwrap(obj);
        engine = new Engine(*queue);
        engine->addListener(this);
        engine->setAudioCallback(this);

        threadSafeEmitter = ThreadSafeFunction::New(
            env, info.This().ToObject().Get("emit").As<Function>(),
            "Medley Emitter",
            0, 1
        );
    }
    catch (std::exception& e) {
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
            done(Napi::Boolean::New(env, false));
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

    auto metadata = deck.metadata();
    auto result = Object::New(env);

    result.Set("title", safeString(env, metadata.getTitle()));
    result.Set("artist", safeString(env, metadata.getArtist()));
    result.Set("album", safeString(env, metadata.getAlbum()));
    result.Set("isrc", safeString(env, metadata.getISRC()));

    auto trackGain = metadata.getTrackGain();
    auto bpm = metadata.getBeatsPerMinute();

    result.Set("trackGain", trackGain != 0.0f ? Napi::Number::New(env, trackGain) : env.Undefined());
    result.Set("bpm", bpm != 0.0f ? Napi::Number::New(env, bpm) : env.Undefined());

    return result;
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

    auto result = Object::New(env);
    result.Set("current", deck.getPosition());
    result.Set("duration", deck.getDuration());
    result.Set("first", deck.getFirstAudiblePosition());
    result.Set("last", deck.getLastAudiblePosition());
    return result;
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
    auto sampleRate = device->getCurrentSampleRate();

    auto requestedSampleRate = options.Has("sampleRate") ? options.Get("sampleRate") : env.Undefined();
    auto outSampleRate = (!requestedSampleRate.IsNull() && !requestedSampleRate.IsUndefined()) ? requestedSampleRate.ToNumber().DoubleValue() : sampleRate;

    uint32_t bufferSize = 0;
    {
        auto jsValue = options.Get("bufferSize");
        if (jsValue.IsNumber()) {
            auto value = jsValue.ToNumber().Uint32Value();
            if (value > 0) {
                bufferSize = value;
            }
        }
    }

    uint32_t buffering = 0;
    {
        auto jsValue = options.Get("buffering");
        if (jsValue.IsNumber()) {
            auto value = jsValue.ToNumber().Int32Value();
            if (value >= 0) {
                buffering = value;
            }
        }
    }

    auto gainJS = options.Has("gain") ? options.Get("gain") : env.Undefined();
    auto gain = (!gainJS.IsNull() && !gainJS.IsUndefined()) ? gainJS.ToNumber().FloatValue() : 1.0f;

    std::shared_ptr<AudioRequest> request;

    registerAudioRequest(
        audioRequestId,
        audioFormat,
        outSampleRate,
        bufferSize,
        buffering,
        gain,
        request
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

bool Medley::registerAudioRequest(uint32_t id, AudioRequestFormat audioFormat, double outSampleRate, uint32_t bufferSize, uint32_t buffering, float gain, std::shared_ptr<AudioRequest>& request) {
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
                return false;
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

    auto device = engine->getCurrentAudioDevice();
    auto numChannels = device->getOutputChannelNames().size();
    auto deviceSampleRate = device->getCurrentSampleRate();

    if (bufferSize == 0) {
        bufferSize = (uint32_t)(outSampleRate * 0.25f);
    }

    if (buffering == 0) {
        buffering = (uint32_t)(outSampleRate * 0.01f);
    }

    request = std::make_shared<AudioRequest>(
        id,
        bufferSize,
        buffering,
        numChannels,
        deviceSampleRate,
        outSampleRate,
        bytesPerSample,
        audioConverters[audioFormat],
        gain
    );

    audioRequests.emplace(id, request);
    return true;
}

void Medley::audioData(const AudioSourceChannelInfo& info) {
    for (auto& [id, req] : audioRequests) {
        req->buffer.write(*info.buffer, info.startSample, info.numSamples);
    }
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
    auto consumer = new AudioConsumer(it->second, size, deferred);
    consumer->Queue();

    return deferred.Promise();
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

    if (options.Has("buffering")) {
        request->buffering = options.Get("buffering").ToNumber().Uint32Value();
    }

    return Boolean::New(env, true);
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

Napi::Value Medley::static_getMetadata(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        RangeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    juce::String trackFile = info[0].ToString().Utf8Value();
    medley::Metadata metadata;
    bool ok = false;

    try {
        ok = metadata.readFromFile(trackFile);
    }
    catch (std::exception e) {
        throw Napi::Error::New(info.Env(), e.what());
    }

    if (!ok) {
        return env.Undefined();
    }

    auto result = Object::New(env);

    result.Set("title", safeString(env, metadata.getTitle()));
    result.Set("artist", safeString(env, metadata.getArtist()));
    result.Set("album", safeString(env, metadata.getAlbum()));
    result.Set("isrc", safeString(env, metadata.getISRC()));
    result.Set("albumArtist", safeString(env, metadata.getAlbumArtist()));
    result.Set("originalArtist", safeString(env, metadata.getOriginalArtist()));

    auto bitrate = metadata.getBitrate();
    auto sampleRate = metadata.getSampleRate();
    auto duration = metadata.getDuration();

    result.Set("bitrate", bitrate != 0.0f ? Napi::Number::New(env, bitrate) : env.Undefined());
    result.Set("sampleRate", sampleRate != 0.0f ? Napi::Number::New(env, sampleRate) : env.Undefined());
    result.Set("duration", duration != 0.0f ? Napi::Number::New(env, duration) : env.Undefined());

    auto trackGain = metadata.getTrackGain();
    auto bpm = metadata.getBeatsPerMinute();

    result.Set("trackGain", trackGain != 0.0f ? Napi::Number::New(env, trackGain) : env.Undefined());
    result.Set("bpm", bpm != 0.0f ? Napi::Number::New(env, bpm) : env.Undefined());

    return result;
}

Napi::Value Medley::static_getCoverAndLyrics(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    juce::String trackFile = info[0].ToString().Utf8Value();

    medley::Metadata::CoverAndLyrics cal(trackFile, true, true);
    auto cover = cal.getCover();
    auto coverData = cover.getData();

    auto result = Object::New(env);

    result.Set("cover", Napi::Buffer<uint8_t>::Copy(env, (uint8_t*)coverData.data(), coverData.size()));
    result.Set("coverMimeType", Napi::String::New(env, cover.getMimeType().toStdString()));
    result.Set("lyrics", Napi::String::New(env, cal.getLyrics().toStdString()));

    return result;
}

Napi::Value Medley::static_isTrackLoadable(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return Boolean::New(env, false);
    }

    auto trackPtr = Track::fromJS(info[0]);
    return Boolean::New(env, medley::utils::isTrackLoadable(supportedFormats, trackPtr));
}

uint32_t Medley::audioRequestId = 0;

Engine::SupportedFormats Medley::supportedFormats;
