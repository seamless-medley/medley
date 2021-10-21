#pragma once

#include <JuceHeader.h>
#include "LevelSmoother.h"

using namespace juce;

class LevelTracker
{
public:
    void process(AudioSampleBuffer& buffer);

    void prepare(const int channels, const int sampleRate, const int latencyInSamples);

    double getLevel(int channel);

    double getPeak(int channel);

    bool isClipping(int channel);

    void update();

private:
    int sampleRate = 44100;
    int samplesPerBlock = 441;
    int64 samplesProcessed = 0;

    std::vector<LevelSmoother> levels;

    RelativeTime holdDuration{ 0.5 };
    RelativeTime latency{ 0 };
};

