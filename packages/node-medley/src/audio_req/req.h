#pragma once

#include <napi.h>
#include <RingBuffer.h>
#include <PostProcessor.h>
#include <Fader.h>
#include "../audio/SecretRabbitCode.h"

namespace audio_req {

struct AudioRequest {
    AudioRequest(
        uint32_t id,
        uint32_t bufferSize,
        uint8_t numChannels,
        int inSampleRate,
        int requestedSampleRate,
        uint8_t outputBytesPerSample,
        std::shared_ptr<juce::AudioData::Converter> converter,
        std::shared_ptr<PostProcessor> processor,
        float preferredGain
    );

    AudioRequest(const AudioRequest& other);

    ~AudioRequest();

    bool running = true;
    uint32_t id;
    uint8_t numChannels;
    int inSampleRate;
    int requestedSampleRate;
    uint8_t outputBytesPerSample;
    //
    RingBuffer<float> buffer;
    std::shared_ptr<juce::AudioData::Converter> converter;
    std::shared_ptr<PostProcessor> processor;
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

}
