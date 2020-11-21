#pragma once

#include <JuceHeader.h>

using namespace juce;

class MiniMP3AudioFormat : public AudioFormat
{
public:
    //==============================================================================
    MiniMP3AudioFormat()
        : AudioFormat("minimp3", ".mp3")
    {

    }

    ~MiniMP3AudioFormat() override {

    }

    //==============================================================================
    Array<int> getPossibleSampleRates() override { return {}; };

    Array<int> getPossibleBitDepths() override { return {}; };

    bool canDoStereo() override { return true; }

    bool canDoMono() override { return true; }

    bool isCompressed() override { return true; }

    StringArray getQualityOptions() override { return {}; }

    //==============================================================================
    AudioFormatReader* createReaderFor(InputStream*, bool deleteStreamIfOpeningFails) override;

    AudioFormatWriter* createWriterFor(
        OutputStream*, double sampleRateToUse,
        unsigned int numberOfChannels, int bitsPerSample,
        const StringPairArray& metadataValues, int qualityOptionIndex
    ) override
    {
        return nullptr;
    }

    using AudioFormat::createWriterFor;
};

