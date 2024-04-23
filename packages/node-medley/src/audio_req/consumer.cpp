#include "consumer.h"

namespace audio_req {

AudioConsumer::AudioConsumer(std::shared_ptr<audio_req::AudioRequest> request, uint64_t requestedSize, const Napi::Promise::Deferred& deferred)
    :
    AudioRequestProcessor(request, Napi::Function::New(deferred.Env(), [deferred](const Napi::CallbackInfo &cbInfo) {
        deferred.Resolve(cbInfo[0]); // cbInfo[0] is the buffer returned from GetResult()
        return cbInfo.Env().Undefined();
    })),
    requestedSize(requestedSize)
{

}

void AudioConsumer::Execute()
{
    Process(requestedSize / request->outputBytesPerSample / request->numChannels);
}

std::vector<napi_value> AudioConsumer::GetResult(Napi::Env env)
{
    auto result = bytesReady == 0
        ? Napi::Buffer<uint8_t>::New(env, 0)
        : Napi::Buffer<uint8_t>::Copy(env, (uint8_t*)request->scratch.getData(), bytesReady);

    return { result };
}

}
