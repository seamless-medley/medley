#include <Medley.h>
#include "processor.h"

using namespace std::chrono_literals;

namespace audio_req {

AudioRequestProcessor::AudioRequestProcessor(std::shared_ptr<AudioRequest> request, const Napi::Env& env)
            : AsyncWorker(env),
            request(request)
{

}

AudioRequestProcessor::AudioRequestProcessor(std::shared_ptr<AudioRequest> request, const Napi::Function& callback)
    : AsyncWorker(callback),
    request(request)
{

}

void AudioRequestProcessor::Process(uint64_t requestedNumSamples)
{
    auto outputBytesPerSample = request->outputBytesPerSample;
    auto numChannels = request->numChannels;

    while (request->buffer.getNumReady() < request->buffering) {
        std::this_thread::sleep_for(5ms);

        if (!request->running) {
            break;
        }
    }


    auto numSamples = juce::jmin((uint64_t)request->buffer.getNumReady(), requestedNumSamples);
    juce::AudioBuffer<float> tempBuffer(numChannels, numSamples);
    request->buffer.read(tempBuffer, numSamples);

    request->currentTime += (numSamples / (double)request->inSampleRate) * 1000;
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

}
