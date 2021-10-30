#pragma once

#include <napi.h>
#include <Medley.h>
#include <RingBuffer.h>
#include "audio/SecretRabbitCode.h"
#include "track.h"
#include "queue.h"

using namespace Napi;

using Engine = medley::Medley;

class Medley : public ObjectWrap<Medley>, public Engine::Callback, public Engine::AudioCallback {
public:

    static void Initialize(Object& exports);

    static void shutdown(const CallbackInfo& info);

    static void workerFinalizer(const CallbackInfo&);

    Medley(const CallbackInfo& info);

    ~Medley();

    void deckTrackScanning(medley::Deck& sender) override;

    void deckTrackScanned(medley::Deck& sender) override;

    void deckPosition(medley::Deck& sender, double position) override;

    void deckStarted(medley::Deck& sender) override;

    void deckFinished(medley::Deck& sender) override;

    void deckLoaded(medley::Deck& sender) override;

    void deckUnloaded(medley::Deck& sender) override;

    void audioDeviceChanged() override;

    void preQueueNext(Engine::Callback::PreCueNextDone done) override;

    void audioData(const AudioSourceChannelInfo& info) override;

    void play(const CallbackInfo& info);

    void stop(const CallbackInfo& info);

    Napi::Value togglePause(const CallbackInfo& info);

    void fadeOut(const CallbackInfo& info);

    void seek(const CallbackInfo& info);

    void seekFractional(const CallbackInfo& info);

    Napi::Value isTrackLoadable(const CallbackInfo& info);

    Napi::Value level(const CallbackInfo& info);

    Napi::Value reduction(const CallbackInfo& info);

    Napi::Value playing(const CallbackInfo& info);

    Napi::Value paused(const CallbackInfo& info);

    Napi::Value duration(const CallbackInfo& info);

    Napi::Value getPosition(const CallbackInfo& info);

    void setPosition(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getVolume(const CallbackInfo& info);

    void setVolume(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getFadingCurve(const CallbackInfo& info);

    void setFadingCurve(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getMinimumLeadingToFade(const CallbackInfo& info);

    void setMinimumLeadingToFade(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getMaximumFadeOutDuration(const CallbackInfo& info);

    void setMaximumFadeOutDuration(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getAvailableDevices(const CallbackInfo& info);

    Napi::Value setAudioDevice(const CallbackInfo& info);

    Napi::Value getMetadata(const CallbackInfo& info);

    Napi::Value requestAudioCallback(const CallbackInfo& info);

    Napi::Value racConsume(const CallbackInfo& info);

    struct AudioRequest {
        AudioRequest(uint32_t id, uint32_t bufferSize, uint8_t numChannels, int inSampleRate, int requestedSampleRate, uint8_t outputBytesPerSample, std::shared_ptr<juce::AudioData::Converter> converter)
            :
            id(id),
            numChannels(numChannels),
            inSampleRate(inSampleRate),
            requestedSampleRate(requestedSampleRate),
            outputBytesPerSample(outputBytesPerSample),
            converter(converter),
            buffer(numChannels, bufferSize)
        {
            if (inSampleRate != requestedSampleRate) {
                for (auto i = 0; i < numChannels; i++) {
                    resamplers.push_back(std::make_unique<SecretRabbitCode>(inSampleRate, requestedSampleRate));
                }
            }
        }

        AudioRequest(const AudioRequest& other)
            :
            id(other.id),
            numChannels(other.numChannels),
            inSampleRate(inSampleRate),
            requestedSampleRate(requestedSampleRate),
            outputBytesPerSample(outputBytesPerSample),
            converter(other.converter),
            buffer(other.buffer),
            resamplers(resamplers)
        {

        }

        uint32_t id;
        uint8_t numChannels;
        int inSampleRate;
        int requestedSampleRate;
        uint8_t outputBytesPerSample;
        //
        std::shared_ptr<juce::AudioData::Converter> converter;
        RingBuffer<float> buffer;
        //
        std::vector<std::shared_ptr<SecretRabbitCode>> resamplers;
        //
        juce::MemoryBlock scratch;
    };
private:
    void emitDeckEvent(const std::string& name,  medley::Deck& deck);

    enum class AudioRequestFormat : uint8_t {
        Int16LE, Int16BE, FloatLE, FloatBE
    };

    static uint32_t audioRequestId;

    std::map<uint32_t, std::shared_ptr<AudioRequest>> audioRequests;

    using NativeAudioFormat = AudioData::Pointer<
        AudioData::Float32,
        AudioData::NativeEndian,
        AudioData::NonInterleaved,
        AudioData::Const
    >;

    using Int16LittleEndianFormat = AudioData::Pointer<
        AudioData::Int16,
        AudioData::LittleEndian,
        AudioData::Interleaved,
        AudioData::NonConst
    >;

    using Int16BigEndianFormat = AudioData::Pointer<
        AudioData::Int16,
        AudioData::BigEndian,
        AudioData::Interleaved,
        AudioData::NonConst
    >;

    using Float32LittleEndianFormat = AudioData::Pointer<
        AudioData::Float32,
        AudioData::LittleEndian,
        AudioData::Interleaved,
        AudioData::NonConst
    >;

    using Float32BigEndianFormat = AudioData::Pointer<
        AudioData::Float32,
        AudioData::BigEndian,
        AudioData::Interleaved,
        AudioData::NonConst
    >;

    std::map<AudioRequestFormat, std::shared_ptr<juce::AudioData::Converter>> audioConverters;

    ObjectReference queueJS;
    Queue* queue = nullptr;
    Engine* engine = nullptr;

    Reference<Napi::Value> self;
    ThreadSafeFunction threadSafeEmitter;
};
