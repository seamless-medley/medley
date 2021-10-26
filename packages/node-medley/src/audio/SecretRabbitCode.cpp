#include "SecretRabbitCode.h"

SecretRabbitCode::SecretRabbitCode(int inRate, int outRate, SecretRabbitCode::Quality quality)
    :
    ratio((double)outRate / (double)inRate),
    quality(quality)
{
    int error;
    state = src_new((int)quality, 1, &error);
    reset();
}

SecretRabbitCode::~SecretRabbitCode() {
    src_delete(state);
}

void SecretRabbitCode::reset() {
    src_reset(state);
}

int SecretRabbitCode::process(const float* in, long inNumSamples, float* out, long outNumSamples, long& numSamplesUsed) {
    SRC_DATA data{
        in,
        out,
        inNumSamples,
        outNumSamples,
        0, 0,
        0,
        ratio
    };

    src_process(state, &data);

    numSamplesUsed = data.input_frames_used;

    return data.output_frames_gen;
}