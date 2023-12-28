#pragma once

#include <JuceHeader.h>
#include <samplerate.h>

class SecretRabbitCode
{
public:
    enum class Quality : int {
        Best = SRC_SINC_BEST_QUALITY,
        Medium = SRC_SINC_MEDIUM_QUALITY,
        Fastest = SRC_SINC_FASTEST,
        ZeroOrderHold = SRC_ZERO_ORDER_HOLD,
        Linear = SRC_LINEAR
    };

    SecretRabbitCode(int inRate, int outRate, Quality quality = Quality::Best);

    ~SecretRabbitCode();

    void reset();

    int process(const float* in, long inNumSamples, float* out, long outNumSamples, long& numSamplesUsed);

    double getRatio() const { return ratio; }
private:
    double ratio;
    Quality quality;

    SRC_STATE* state = nullptr;
};
