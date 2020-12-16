#include "LevelTracker.h"

void LevelTracker::process(AudioSampleBuffer& buffer)
{
    const auto numChannels = buffer.getNumChannels();
    const auto numSamples = buffer.getNumSamples();

    const auto numBlocks = jmax(1, (int)(numSamples / samplesPerBlock));

    for (int channel = 0; channel < std::min(numChannels, int(levels.size())); channel++) {
        for (int block = 0; block < numBlocks; block++) {
            Time time = Time((int64)((double)samplesProcessed / sampleRate * 1000));

            auto start = block * numBlocks;
            auto numSamplesThisTime = jmin(numSamples - start, samplesPerBlock);

            levels[channel].addLevel(time, buffer.getMagnitude(channel, start, numSamplesThisTime), holdDuration);

            samplesProcessed += numSamplesThisTime;
        }
    }
}

void LevelTracker::prepare(const int channels, const int sampleRate, const int latencyInSamples, const int backlogSize)
{
    this->sampleRate = sampleRate;
    samplesPerBlock = (int)(sampleRate * 0.1 / (double)backlogSize);

    latency = RelativeTime((double)latencyInSamples / sampleRate);

    levels.clear();
    levels.resize(channels, LevelSmoother(sampleRate, backlogSize));
}

double LevelTracker::getLevel(int channel) {
    return channel < (int)levels.size() ? levels[channel].get().level : 0.0;
}

double LevelTracker::getPeak(int channel)
{
    return channel < (int)levels.size() ? levels[channel].get().peak : 0.0;
}

bool LevelTracker::isClipping(int channel)
{
    return channel < (int)levels.size() ? levels[channel].get().clip : false;
}

void LevelTracker::update()
{
    auto time = Time((int64)((double)samplesProcessed / sampleRate * 1000)) - latency;

    for (auto& lv : levels) {
        lv.update(time);
    }
}
