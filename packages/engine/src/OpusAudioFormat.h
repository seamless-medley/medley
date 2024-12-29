#pragma once

#include <JuceHeader.h>

class OpusAudioFormat : public juce::AudioFormat
{
public:
    OpusAudioFormat()
        : juce::AudioFormat("opus", ".opus")
    {

    }

    ~OpusAudioFormat() override {

    }

    juce::Array<int> getPossibleSampleRates() override { return { 48000 }; };

    juce::Array<int> getPossibleBitDepths() override { return { }; };

    bool canDoStereo() override { return true; }

    bool canDoMono() override { return true; }

    bool isCompressed() override { return true; }

    juce::StringArray getQualityOptions() override { return {}; }

    juce::AudioFormatReader* createReaderFor(juce::InputStream*, bool deleteStreamIfOpeningFails) override;

    juce::AudioFormatWriter* createWriterFor(
        juce::OutputStream*, double sampleRateToUse,
        unsigned int numberOfChannels, int bitsPerSample,
        const juce::StringPairArray& metadataValues, int qualityOptionIndex
    ) override
    {
        return nullptr;
    }

    using AudioFormat::createWriterFor;
};
