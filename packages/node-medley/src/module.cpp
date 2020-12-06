#include <napi.h>
#include "core.h"

using namespace Napi;

Object Init(Env env, Object exports) {
    Medley::Initialize(exports);
    Queue::Initialize(exports);
    return exports;
}

NODE_API_MODULE(medley, Init)