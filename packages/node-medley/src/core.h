#pragma once

#include <thread>
#include <napi.h>
#include <Medley.h>
#include <ITrack.h>
#include <ILogger.h>
#include "audio_req/consumer.h"
#include "track.h"
#include "queue.h"
#include "version.h"

using namespace Napi;

using Engine = medley::Medley;

class Medley : public ObjectWrap<Medley>, public Engine::Callback, public Engine::AudioCallback, public medley::ILoggerWriter {
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

    void log(medley::LogLevel level, juce::String& name, juce::String& msg) const override;

    void audioDeviceChanged() override;

    void enqueueNext(Engine::Callback::EnqueueNextDone done) override;

    void audioDeviceUpdate(juce::AudioIODevice* device, const medley::Medley::AudioDeviceConfig& config) override;

    void audioData(const AudioSourceChannelInfo& info, double timestamp) override;

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

    Napi::Object getKaraokeParams(KaraokeParamController& ctrl, const CallbackInfo& info);

    void setKaraokeParams(KaraokeParamController& ctrl, const Napi::Object& params);

    Napi::Value getFx(const CallbackInfo& info);

    Napi::Value setFx(const CallbackInfo& info);

    Napi::Value reqAudioGetFx(const CallbackInfo& info);

    Napi::Value reqAudioSetFx(const CallbackInfo& info);

    static Napi::Value static_getMetadata(const Napi::CallbackInfo& info);

    static Napi::Value static_getAudioProperties(const Napi::CallbackInfo& info);

    static Napi::Value static_getCoverAndLyrics(const Napi::CallbackInfo& info);

    static Napi::Value static_isTrackLoadable(const Napi::CallbackInfo& info);

    static Napi::Value static_getInfo(const Napi::CallbackInfo& info);
private:

    enum class AudioRequestFormat : uint8_t {
        Int16LE, Int16BE, FloatLE, FloatBE
    };

    void emitDeckEvent(const std::string& name, medley::Deck& deck, medley::TrackPlay& track);

    std::shared_ptr<audio_req::AudioRequest> registerAudioRequest(uint32_t id, AudioRequestFormat audioFormat, double outSampleRate, uint32_t bufferSize, uint32_t buffering, float gain, Napi::Value fx);

    static uint32_t audioRequestId;

    std::map<uint32_t, std::shared_ptr<audio_req::AudioRequest>> audioRequests;

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
