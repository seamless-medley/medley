#include "LevelTracker.h"

namespace {
    constexpr auto kPeakDecayRate = 0.0086525;
}

void LevelTracker::process(AudioSampleBuffer& buffer)
{   
    const auto numChannels = buffer.getNumChannels();
    const auto numSamples = buffer.getNumSamples();

    const auto numBlocks = (int)(numSamples / samplesPerBlock);

    for (int channel = 0; channel < std::min(numChannels, int(levels.size())); channel++) {
        for (int block = 0; block < numBlocks; block++) {
            lastMeasurement = Time((int64)((double)samplesProcessed / sampleRate * 1000));
            
            auto start = block * numBlocks;
            auto numSamplesThisTime = jmin(numSamples - start, samplesPerBlock);

            levels[channel].setLevels(lastMeasurement, buffer.getMagnitude(channel, start, numSamplesThisTime), holdDuration);

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
    levels.resize(channels, LevelInfo(sampleRate, latencyInSamples / samplesPerBlock, backlogSize));
}

double LevelTracker::getLevel(int channel) {
    return channel < (int)levels.size() ? levels[channel].read().level : 0.0;
}

double LevelTracker::getPeak(int channel)
{
    return channel < (int)levels.size() ? levels[channel].read().peak : 0.0;
}

bool LevelTracker::isClipping(int channel)
{
    return channel < (int)levels.size() ? levels[channel].read().clip : false;
} 

void LevelTracker::update()
{
    auto time = Time((int64)((double)samplesProcessed / sampleRate * 1000)) - latency;

    for (auto& lv : levels) {
        lv.update(time);
    }
}

LevelTracker::LevelInfo::LevelInfo(int sampleRate, int resultSize, int backlogSize)
    :
    resultSize(resultSize),
    backlogSize(backlogSize),
    backlog(backlogSize, 0.0)
{

}

void LevelTracker::LevelInfo::setLevels(const Time time, const double newLevel, const RelativeTime hold)
{
    if (newLevel > 1.0) {
        clip = true;
    }

    auto avgPeak = getAverageLevel();

    if (avgPeak >= peak)
    {
        peak = jmin(1.0, avgPeak);
        holdUntil = time + hold;
    }
    else if (time > holdUntil)
    {
        peak -= kPeakDecayRate;
        clip = peak > 1.0;
    }

    push(jmin(1.0, newLevel));

    avgPeak = getAverageLevel();
    if (peak < avgPeak) {
        peak = avgPeak;
    }

    Level lv{};
    lv.time = time;
    lv.clip = clip;
    lv.level = avgPeak;
    lv.peak = peak;

    results.push(lv);
}

LevelTracker::LevelInfo::Level& LevelTracker::LevelInfo::read()
{
    return currentResult;
}

void LevelTracker::LevelInfo::update(const Time time)
{
    while (!results.empty()) {
        auto first = results.front();
        if (time <= first.time) break;

        currentResult.level = (currentResult.level + first.level) / 2.0;
        currentResult.peak = (currentResult.peak + first.peak) / 2.0;
        currentResult.clip |= first.clip;

        results.pop();
    }
}

double LevelTracker::LevelInfo::getAverageLevel() const
{
    if (backlog.size() > 0) {
        return std::accumulate(backlog.begin(), backlog.end(), 0.0) / backlog.size();
    }

    return level;
}

void LevelTracker::LevelInfo::push(double level) {
    level = jmin(level, 1.0);
    if (backlog.size() > 0)
    {
        backlog[backlogIndex] = level;
        backlogIndex = (backlogIndex + 1) % backlog.size();
    }
    else
    {
        this->level = level;
    }
}
