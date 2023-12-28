#pragma once

#include "req.h"

namespace audio_req {

class AudioRequestProcessor : public Napi::AsyncWorker {
public:
    AudioRequestProcessor(std::shared_ptr<AudioRequest> request, const Napi::Env& env);
    AudioRequestProcessor(std::shared_ptr<AudioRequest> request, const Napi::Function& callback);

protected:
    void Process(uint64_t requestedNumSamples);

    std::shared_ptr<AudioRequest> request;
    uint64_t bytesReady = 0;
};

}
