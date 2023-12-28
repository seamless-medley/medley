#pragma once

#include <JuceHeader.h>

using namespace juce;
using namespace dsp;

class DeFXKaraoke : public ProcessorBase
{
public:
    enum class Param : uint8_t {
        Mix,
        OriginalBgLevel,
        LowPassCutOff,
        LowPassQ,
        HighPassCutOff,
        HighPassQ
    };

    DeFXKaraoke();

    void prepare(const ProcessSpec& spec) override;

    void process(const ProcessContextReplacing<float>& context) override;

    void reset() override;

    bool isEnabled() const;

    void setEnabled(bool value);

    float getParam(Param index) const;

    float setParam(Param index, float newValue);
private:
    void updateFilter(bool force);

    std::unique_ptr<IIR::Filter<double>> lowPassFilter;
    std::unique_ptr<IIR::Filter<double>> highPassFilter;

    double sampleRate = 44100.0;

    bool enabled = false;

    float mix = 1.0f;
    float originalBgLevel = 0.4f;

    float lowpassCutOff = 100.0f;
    float lowpassQ = 2.0f;

    float highpassCutOff = 7000.0f;
    float highpassQ = 2.0f;

    float lastLowpassCutOff;
    float lastLowpassQ;

    float lastHighpassCutOff;
    float lastHighpassQ;
};

