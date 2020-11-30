#pragma once

// Adapted from https://github.com/DanielRudrich/SimpleCompressor

#include <JuceHeader.h>
#include "ReductionCalculator.h"
#include "LookAheadReduction.h"

using namespace juce::dsp;

class LookAheadLimiter : public ProcessorBase
{
public:
    LookAheadLimiter();

    void prepare(const ProcessSpec& spec);

    void process(const ProcessContextReplacing<float>& context);

    void reset();

private:
    class Delay {
    private:
        void prepare(const ProcessSpec& spec);

        void process(const ProcessContextReplacing<float>& context);

        void getReadWritePositions(bool read, int numSamples, int& startIndex, int& blockSize1, int& blockSize2);

        void setDelayTime(float delayTimeInSeconds);

        friend class LookAheadLimiter;

        ProcessSpec spec = { -1, 0, 0 };
        float delayPeriod;
        int delayInSamples = 0;
        bool bypassed = false;
        int writePosition = 0;
        juce::AudioBuffer<float> buffer;
    };


    Delay delay;
    ReductionCalculator gainReductionCalculator;
    LookAheadReduction lookAheadFadeIn;
    juce::AudioBuffer<float> sideChainBuffer;
};

