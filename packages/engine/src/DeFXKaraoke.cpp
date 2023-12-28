#include "DeFXKaraoke.h"

using namespace juce;
using namespace dsp;

DeFXKaraoke::DeFXKaraoke()
{
    lastLowpassCutOff = lowpassCutOff;
    lastLowpassQ = lowpassQ;

    lastHighpassCutOff = highpassCutOff;
    lastHighpassQ = highpassQ;

    lowPassFilter = std::make_unique<IIR::Filter<double>>();
    highPassFilter = std::make_unique<IIR::Filter<double>>();

    reset();
}

void DeFXKaraoke::prepare(const ProcessSpec& spec)
{
    sampleRate = spec.sampleRate;

    lowPassFilter->prepare(spec);
    highPassFilter->prepare(spec);


    updateFilter(true);

    lowPassFilter->reset();
    highPassFilter->reset();
}

void DeFXKaraoke::process(const ProcessContextReplacing<float>& context)
{
    if (context.isBypassed || mix <= 0.0f) {
        return;
    }

    const auto& input = context.getInputBlock();
    const auto& output = context.getOutputBlock();

    auto totalNumInputChannels = jmin(input.getNumChannels(), (size_t)2);

    if (totalNumInputChannels < 2) {
        // Cannot process mono channel input
        return;
    }

    const auto numSamples = input.getNumSamples();

    auto in_left = input.getChannelPointer(0);
    auto in_right = input.getChannelPointer(1);

    auto out_left = output.getChannelPointer(0);
    auto out_right = output.getNumChannels() > 1 ? output.getChannelPointer(1) : nullptr;

    updateFilter(false);

    for (int i = 0; i < (int)numSamples; ++i) {
        auto l = in_left[i];
        auto r = in_right[i];

        auto mono = (l * 0.25) + (r * 0.25);
        auto mono_filtered = (float)(lowPassFilter->processSample(mono) + highPassFilter->processSample(mono));

        // Snap
        lowPassFilter->snapToZero();
        highPassFilter->snapToZero();

        auto bg = mono_filtered * 1.25f * originalBgLevel;
        auto bgMix = bg * mix;

        out_left[i] = l - (r * mix) + bgMix;

        if (out_right != nullptr) {
            out_right[i] = r - (l * mix) + bgMix;
        }
    }
}

void DeFXKaraoke::reset()
{
    mix = 0.8f;
    originalBgLevel = 0.65f;

    lowpassCutOff = 125.0f;
    lowpassQ = 3.5f;

    highpassCutOff = 7000.0f;
    highpassQ = 2.0f;

    updateFilter(true);
}

float DeFXKaraoke::getParam(Param index) const
{
    switch (index)
    {
    case DeFXKaraoke::Param::Mix:
        return mix;

    case DeFXKaraoke::Param::OriginalBgLevel:
        return originalBgLevel;

    case DeFXKaraoke::Param::LowPassCutOff:
        return lowpassCutOff;

    case DeFXKaraoke::Param::LowPassQ:
        return lowpassQ;

    case DeFXKaraoke::Param::HighPassCutOff:
        return highpassCutOff;

    case DeFXKaraoke::Param::HighPassQ:
        return highpassQ;

    default:
        return 0.0f;
    }
}

float DeFXKaraoke::setParam(Param index, float newValue)
{
    switch (index)
    {
    case DeFXKaraoke::Param::Mix:
        return mix = jlimit(0.0f, 1.0f, newValue);

    case DeFXKaraoke::Param::OriginalBgLevel:
        return originalBgLevel = jlimit(0.0f, 1.0f, newValue);

    case DeFXKaraoke::Param::LowPassCutOff:
        return lowpassCutOff = jlimit(10.0f, 20000.0f, newValue);

    case DeFXKaraoke::Param::LowPassQ:
        return lowpassQ = jlimit(0.01f, 10.0f, newValue);

    case DeFXKaraoke::Param::HighPassCutOff:
        return highpassCutOff = jlimit(10.0f, 20000.0f, newValue);

    case DeFXKaraoke::Param::HighPassQ:
        return highpassQ = jlimit(0.01f, 10.0f, newValue);

    default:
        return 0.0f;
    }
}

void DeFXKaraoke::updateFilter(bool force)
{
    if (force || (lowpassCutOff != lastLowpassCutOff) || (lowpassQ != lastLowpassQ)) {
        lowPassFilter->coefficients = dsp::IIR::Coefficients<double>::makeLowPass(sampleRate, lowpassCutOff, lowpassQ);

        lastLowpassCutOff = lowpassCutOff;
        lastLowpassQ = lowpassQ;
    }

    if (force || (highpassCutOff != lastHighpassCutOff) || (highpassQ != lastHighpassQ)) {
        highPassFilter->coefficients = dsp::IIR::Coefficients<double>::makeHighPass(sampleRate, highpassCutOff, highpassQ);

        lastHighpassCutOff = highpassCutOff;
        lastHighpassQ = highpassQ;
    }
}
