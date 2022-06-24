#pragma once

// Adapted from https://github.com/DanielRudrich/SimpleCompressor

#include <JuceHeader.h>
#include "ReductionCalculator.h"
#include "LookAheadReduction.h"

using namespace juce;
using namespace dsp;

class LookAheadLimiter : public ProcessorBase
{
public:
    LookAheadLimiter();

    void prepare(const ProcessSpec& spec) override;

    void process(const ProcessContextReplacing<float>& context) override;

    void reset() override;

    /**
     * Reduction in dB
     */
    float getReduction() const { return reduction; }

private:
    class Delay {
    private:
        void prepare(const ProcessSpec& spec);

        void process(const ProcessContextReplacing<float>& context);

        void getReadWritePositions(bool read, int numSamples, int& startIndex, int& blockSize1, int& blockSize2);

        void setDelayTime(float delayTimeInSeconds);

        friend class LookAheadLimiter;

        ProcessSpec spec = { -1, 0, 0 };
        float delayPeriod = 0.0f;
        int delayInSamples = 0;
        bool bypassed = false;
        int writePosition = 0;
        juce::AudioBuffer<float> buffer;
    };

    float reduction = 0.0f;

    Delay delay;
    ReductionCalculator gainReductionCalculator;
    LookAheadReduction lookAheadFadeIn;
    juce::AudioBuffer<float> sideChainBuffer;
};
