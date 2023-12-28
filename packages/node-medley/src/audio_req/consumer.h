#pragma once

#include "processor.h"

namespace audio_req {

class AudioConsumer : public AudioRequestProcessor {
public:
    AudioConsumer(std::shared_ptr<audio_req::AudioRequest> request, uint64_t requestedSize, const Napi::Promise::Deferred& deferred);

    void Execute() override;

    std::vector<napi_value> GetResult(Napi::Env env) override;
private:
    uint64_t requestedSize;
};

}
