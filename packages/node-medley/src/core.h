#pragma once

#include <thread>
#include <napi.h>
#include <Medley.h>
#include <RingBuffer.h>
#include <ITrack.h>
#include <Fader.h>
#include "audio/SecretRabbitCode.h"
#include "track.h"
#include "queue.h"

using namespace Napi;

using Engine = medley::Medley;

class Medley : public ObjectWrap<Medley>, public Engine::Callback, public Engine::AudioCallback {
public:

    static void Initialize(Object& exports);

    Medley(const CallbackInfo& info);

    ~Medley();

    void deckTrackScanning(medley::Deck& sender) override;

    void deckTrackScanned(medley::Deck& sender) override;

    void deckPosition(medley::Deck& sender, double position) override;

    void deckStarted(medley::Deck& sender, medley::TrackPlay& track) override;

    void deckFinished(medley::Deck& sender, medley::TrackPlay& track) override;

    void deckLoaded(medley::Deck& sender, medley::TrackPlay& track) override;

    void deckUnloaded(medley::Deck& sender, medley::TrackPlay& track) override;

    void mainDeckChanged(medley::Deck& sender, medley::TrackPlay& track) override;

    void audioDeviceChanged() override;

    void enqueueNext(Engine::Callback::EnqueueNextDone done) override;

    void audioData(const AudioSourceChannelInfo& info) override;

    Napi::Value play(const CallbackInfo& info);

    void stop(const CallbackInfo& info);

    Napi::Value togglePause(const CallbackInfo& info);

    Napi::Value fadeOut(const CallbackInfo& info);

    void seek(const CallbackInfo& info);

    void seekFractional(const CallbackInfo& info);

    Napi::Value level(const CallbackInfo& info);

    Napi::Value reduction(const CallbackInfo& info);

    Napi::Value playing(const CallbackInfo& info);

    Napi::Value paused(const CallbackInfo& info);

    Napi::Value getVolume(const CallbackInfo& info);

    void setVolume(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getFadingCurve(const CallbackInfo& info);

    void setFadingCurve(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getMinimumLeadingToFade(const CallbackInfo& info);

    void setMinimumLeadingToFade(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getMaximumFadeOutDuration(const CallbackInfo& info);

    void setMaximumFadeOutDuration(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getReplayGainBoost(const CallbackInfo& info);

    void setReplayGainBoost(const CallbackInfo& info, const Napi::Value& value);

    Napi::Value getAvailableDevices(const CallbackInfo& info);

    Napi::Value setAudioDevice(const CallbackInfo& info);

    Napi::Value getAudioDevice(const CallbackInfo& info);

    Napi::Value getDeckMetadata(const CallbackInfo& info);

    Napi::Value getDeckPositions(const CallbackInfo& info);

    Napi::Value requestAudioStream(const CallbackInfo& info);

    Napi::Value reqAudioConsume(const CallbackInfo& info);

    Napi::Value updateAudioStream(const CallbackInfo& info);

    Napi::Value reqAudioDispose(const CallbackInfo& info);

    static Napi::Value static_getMetadata(const Napi::CallbackInfo& info);

    static Napi::Value static_getCoverAndLyrics(const Napi::CallbackInfo& info);

    static Napi::Value static_isTrackLoadable(const Napi::CallbackInfo& info);

    struct AudioRequest {
        AudioRequest(uint32_t id, uint32_t bufferSize, uint32_t buffering, uint8_t numChannels, int inSampleRate, int requestedSampleRate, uint8_t outputBytesPerSample, std::shared_ptr<juce::AudioData::Converter> converter, float preferredGain)
            :
            id(id),
            buffering(buffering),
            numChannels(numChannels),
            inSampleRate(inSampleRate),
            requestedSampleRate(requestedSampleRate),
            outputBytesPerSample(outputBytesPerSample),
            buffer(numChannels, bufferSize),
            converter(converter),
            preferredGain(preferredGain)
        {
            if (inSampleRate != requestedSampleRate) {
                for (auto i = 0; i < numChannels; i++) {
                    resamplers.push_back(std::make_unique<SecretRabbitCode>(inSampleRate, requestedSampleRate));
                }
            }

            fader.reset(preferredGain);
        }

        AudioRequest(const AudioRequest& other)
            :
            id(other.id),
            numChannels(other.numChannels),
            inSampleRate(other.inSampleRate),
            requestedSampleRate(other.requestedSampleRate),
            outputBytesPerSample(other.outputBytesPerSample),
            buffer(other.buffer),
            converter(other.converter),
            resamplers(other.resamplers)
        {

        }

        bool running = true;
        uint32_t id;
        uint32_t buffering;
        uint8_t numChannels;
        int inSampleRate;
        int requestedSampleRate;
        uint8_t outputBytesPerSample;
        //
        RingBuffer<float> buffer;
        std::shared_ptr<juce::AudioData::Converter> converter;
        //
        std::vector<std::shared_ptr<SecretRabbitCode>> resamplers;
        //
        juce::MemoryBlock scratch;
        //
        float lastGain = 1.0f;
        float preferredGain = 1.0f;
        //
        Fader fader;
        //
        double currentTime = 0;
    };
private:

    enum class AudioRequestFormat : uint8_t {
        Int16LE, Int16BE, FloatLE, FloatBE
    };

    void emitDeckEvent(const std::string& name, medley::Deck& deck, medley::TrackPlay& track);

    bool registerAudioRequest(uint32_t id, AudioRequestFormat audioFormat, double outSampleRate, uint32_t bufferSize, uint32_t buffering, float gain, std::shared_ptr<AudioRequest>& request);

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

    static Engine::SupportedFormats supportedFormats;
};
