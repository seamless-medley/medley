#pragma once

#include "req.h"

namespace audio_req {

AudioRequest::AudioRequest(
    uint32_t id,
    uint32_t bufferSize,
    uint32_t buffering,
    uint8_t numChannels,
    int inSampleRate,
    int requestedSampleRate,
    uint8_t outputBytesPerSample,
    std::shared_ptr<juce::AudioData::Converter> converter,
    std::shared_ptr<PostProcessor> processor,
    float preferredGain
) :
    id(id),
    buffering(buffering),
    numChannels(numChannels),
    inSampleRate(inSampleRate),
    requestedSampleRate(requestedSampleRate),
    outputBytesPerSample(outputBytesPerSample),
    buffer(numChannels, bufferSize),
    converter(converter),
    processor(processor),
    preferredGain(preferredGain)
{
    if (inSampleRate != requestedSampleRate) {
        for (auto i = 0; i < numChannels; i++) {
            resamplers.push_back(std::make_shared<SecretRabbitCode>(inSampleRate, requestedSampleRate));
        }
    }

    fader.reset(preferredGain);
}

AudioRequest::AudioRequest(const AudioRequest& other)
    :
    id(other.id),
    numChannels(other.numChannels),
    inSampleRate(other.inSampleRate),
    requestedSampleRate(other.requestedSampleRate),
    outputBytesPerSample(other.outputBytesPerSample),
    buffer(other.buffer),
    converter(other.converter),
    processor(other.processor),
    resamplers(other.resamplers),
    preferredGain(preferredGain)
{

}

AudioRequest::~AudioRequest() {
    processor.reset();

    for (auto resampler : resamplers) {
        resampler.reset();
    }
}

}
