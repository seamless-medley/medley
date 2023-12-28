#pragma once

#include <JuceHeader.h>
#include "LevelSmoother.h"

using namespace juce;

class LevelTracker
{
public:
    LevelTracker();

    LevelTracker(const LevelTracker& other);

    void process(const AudioSourceChannelInfo& info);

    void prepare(const int channels, const int sampleRate, const int latencyInSamples);

    double getLevel(int channel) const;

    double getPeak(int channel) const;

    bool isClipping(int channel) const;

    void update();

private:
    int sampleRate = 44100;
    int samplesPerBlock = 441;
    int64 samplesProcessed = 0;

    std::vector<std::shared_ptr<LevelSmoother>> levels;

    RelativeTime holdDuration{ 0.5 };
    RelativeTime latency{ 0 };
};

