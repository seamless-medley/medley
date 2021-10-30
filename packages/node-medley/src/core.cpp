#include "core.h"

void Medley::Initialize(Object& exports) {
    auto proto = {
        StaticMethod<&Medley::shutdown>("shutdown"),
        //
        InstanceMethod<&Medley::getAvailableDevices>("getAvailableDevices"),
        InstanceMethod<&Medley::setAudioDevice>("setAudioDevice"),
        InstanceMethod<&Medley::play>("play"),
        InstanceMethod<&Medley::stop>("stop"),
        InstanceMethod<&Medley::togglePause>("togglePause"),
        InstanceMethod<&Medley::fadeOut>("fadeOut"),
        InstanceMethod<&Medley::seek>("seek"),
        InstanceMethod<&Medley::seekFractional>("seekFractional"),
        InstanceMethod<&Medley::isTrackLoadable>("isTrackLoadable"),
        InstanceMethod<&Medley::getMetadata>("getMetadata"),
        InstanceMethod<&Medley::requestAudioCallback>("*$rac"),
        InstanceMethod<&Medley::racConsume>("*$rac$consume"),
        //
        InstanceAccessor<&Medley::level>("level"),
        InstanceAccessor<&Medley::reduction>("reduction"),
        InstanceAccessor<&Medley::playing>("playing"),
        InstanceAccessor<&Medley::paused>("paused"),
        InstanceAccessor<&Medley::duration>("duration"),
        InstanceAccessor<&Medley::getPosition, &Medley::setPosition>("position"),
        InstanceAccessor<&Medley::getVolume, &Medley::setVolume>("volume"),
        InstanceAccessor<&Medley::getFadingCurve, &Medley::setFadingCurve>("fadingCurve"),
        InstanceAccessor<&Medley::getMinimumLeadingToFade, &Medley::setMinimumLeadingToFade>("minimumLeadingToFade"),
        InstanceAccessor<&Medley::getMaximumFadeOutDuration, &Medley::setMaximumFadeOutDuration>("maximumFadeOutDuration"),
    };

    auto env = exports.Env();
    exports.Set("Medley", DefineClass(env, "Medley", proto));
}

void Medley::shutdown(const CallbackInfo& info) {
    // shutdownWorker();
}

void Medley::workerFinalizer(const CallbackInfo&) {

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

void Medley::deckTrackScanning(medley::Deck& sender) {

}

void Medley::deckTrackScanned(medley::Deck& sender) {

}

void Medley::deckPosition(medley::Deck& sender, double position) {

}

void Medley::deckStarted(medley::Deck& sender, medley::ITrack::Ptr& track) {
    emitDeckEvent("started", sender, track);
}

void Medley::deckFinished(medley::Deck& sender, medley::ITrack::Ptr& track) {
    emitDeckEvent("finished", sender, track);
}

void Medley::deckLoaded(medley::Deck& sender, medley::ITrack::Ptr& track) {
    emitDeckEvent("loaded", sender, track);
}

void Medley::deckUnloaded(medley::Deck& sender, medley::ITrack::Ptr& track) {
    emitDeckEvent("unloaded", sender, track);
}

void Medley::audioDeviceChanged() {
    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function fn) {
        fn.Call(self.Value(), { Napi::String::New(env, "audioDeviceChanged") });
    });
}

/**
 * Called from Medley
 */
void Medley::preQueueNext(PreCueNextDone done) {
    // Emit preQueueNext event to JS, propagate the result back to Medley via `done` function
    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function emitFn) {
        try {
            auto callback = Napi::Function::New(env, [done](const CallbackInfo &cbInfo) {
                done(cbInfo.Length() > 0 ? cbInfo[0].ToBoolean() : false);
            });

            emitFn.Call(self.Value(), { Napi::String::New(env, "preQueueNext"), callback });
        } catch (const Error&) {
            done(Napi::Boolean::New(env, false));
        }
    });
}

void Medley::emitDeckEvent(const std::string& name,  medley::Deck& deck, medley::ITrack::Ptr& track) {
    auto index = &deck == &engine->getDeck1() ? 0 : 1;
    auto path = track->getFile().getFullPathName().toRawUTF8();

    threadSafeEmitter.NonBlockingCall([=](Napi::Env env, Napi::Function fn) {
        fn.Call(self.Value(), {
            Napi::String::New(env, name),
            Napi::Number::New(env, index),
            Napi::String::New(env, path)
        });
    });
}

void Medley::play(const CallbackInfo& info) {
    engine->play();
}

void Medley::stop(const CallbackInfo& info) {
    engine->stop();
}

Napi::Value Medley::togglePause(const CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), engine->togglePause());
}

void Medley::fadeOut(const CallbackInfo& info) {
    engine->fadeOutMainDeck();
}

void Medley::seek(const CallbackInfo& info) {
    engine->setPosition(info[0].ToNumber().DoubleValue());
}

void Medley::seekFractional(const CallbackInfo& info) {
    engine->setPositionFractional(info[0].ToNumber().DoubleValue());
}

Napi::Value Medley::isTrackLoadable(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return Boolean::New(env, false);
    }

    auto trackPtr = new Track(Track::fromJS(info[0]));
    return Boolean::New(env, engine->isTrackLoadable(trackPtr));
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

Napi::Value Medley::duration(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getDuration());
}

Napi::Value Medley::getPosition(const CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine->getPositionInSeconds());
}

void Medley::setPosition(const CallbackInfo& info, const Napi::Value& value) {
    engine->setPosition(value.ToNumber().DoubleValue());
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

Napi::Value Medley::getMetadata(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto arg1 = info[0];
    if (!arg1.IsNumber()) {
        TypeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto index = arg1.ToNumber().Int32Value();
    if (index != 0 && index != 1) {
        TypeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto& deck = (index == 0) ? engine->getDeck1() : engine->getDeck2();

    auto metadata = deck.metadata();
    auto result = Object::New(env);

    result.Set("title", metadata.getTitle().toRawUTF8());
    result.Set("artist", metadata.getArtist().toRawUTF8());
    result.Set("album", metadata.getAlbum().toRawUTF8());
    result.Set("trackGain", metadata.getTrackGain());

    return result;
}

Napi::Value Medley::requestAudioCallback(const CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1) {
        TypeError::New(env, "Insufficient parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto options = info[0].ToObject();
    auto format = options.Get("format").ToString();
    auto bufferSize = jmax(options.Get("bufferSize").ToNumber().Uint32Value(), 512U * 64U);
    auto requestedSampleRate = options.Has("sampleRate") ? options.Get("sampleRate") : env.Undefined();

    auto formatStr = juce::String(format.ToString().Utf8Value());
    auto validFormats = juce::StringArray("Int16LE", "Int16BE", "FloatLE", "FloatBE");
    auto formatIndex = validFormats.indexOf(formatStr);

    if (!format.IsString() || formatIndex == -1) {
        TypeError::New(env, "Invalid parameter").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto audioFormat = static_cast<AudioRequestFormat>(formatIndex);
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
                return env.Undefined();
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
    auto sampleRate = device->getCurrentSampleRate();
    auto outSampleRate = (!requestedSampleRate.IsNull() && !requestedSampleRate.IsUndefined()) ? requestedSampleRate.ToNumber().DoubleValue() : sampleRate;

    auto request = std::make_shared<AudioRequest>(
        audioRequestId,
        bufferSize,
        numChannels,
        sampleRate,
        outSampleRate,
        bytesPerSample,
        audioConverters[audioFormat]
    );
    audioRequests.emplace(audioRequestId, request);

    auto result = Object::New(env);
    //
    result.Set("id", audioRequestId++);
    result.Set("channels", numChannels);
    result.Set("bitPerSample", bytesPerSample * 8);
    result.Set("originalSampleRate", sampleRate);
    result.Set("sampleRate", outSampleRate);
    //
    return result;
}

void Medley::audioData(const AudioSourceChannelInfo& info) {
    for (auto& [id, req] : audioRequests) {
        req->buffer.write(*info.buffer, info.startSample, info.numSamples);
    }
}

namespace {
    class AudioConsumer : public AsyncWorker {
    public:
        AudioConsumer(std::shared_ptr<Medley::AudioRequest> request, uint64_t requestedSize, const Promise::Deferred& deferred)
            :
            AsyncWorker(Napi::Function::New(deferred.Env(), [deferred](const CallbackInfo &cbInfo) {
                deferred.Resolve(cbInfo[0]);
                return cbInfo.Env().Undefined();
            })),
            request(request),
            requestedSize(requestedSize)
        {

        }

        void Execute() override
        {
            auto outputBytesPerSample = request->outputBytesPerSample;
            auto numChannels = request->numChannels;
            auto numSamples = jmin((uint64_t)request->buffer.getNumReady(), requestedSize / outputBytesPerSample / numChannels);

            juce::AudioBuffer<float> tempBuffer(numChannels, numSamples);
            request->buffer.read(tempBuffer, numSamples);

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

        std::vector<napi_value> GetResult(Napi::Env env) override {
            auto result = Napi::Buffer<uint8_t>::Copy(env, (uint8_t*)request->scratch.getData(), bytesReady);
            return { result };
        }
    private:
        std::shared_ptr<Medley::AudioRequest> request;
        uint64_t requestedSize;
        uint64_t bytesReady = 0;
    };
}

Napi::Value Medley::racConsume(const CallbackInfo& info) {
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


uint32_t Medley::audioRequestId = 0;