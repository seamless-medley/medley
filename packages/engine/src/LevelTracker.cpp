#include "LevelTracker.h"

namespace {
    constexpr auto kPeakDecayRate = 0.0086525;
}

void LevelTracker::process(AudioSampleBuffer& buffer)
{
    lastMeasurement = Time::currentTimeMillis();

    const auto numChannels = buffer.getNumChannels();
    const auto numSamples = buffer.getNumSamples();

    const auto numBlocks = (int)(numSamples / samplesPerBlock);

    for (int channel = 0; channel < std::min(numChannels, int(levels.size())); channel++) {
        for (int block = 0; block < numBlocks; block++) {
            auto start = block * numBlocks;
            levels[channel].setLevels(lastMeasurement, buffer.getMagnitude(channel, start, jmin(numSamples - start, samplesPerBlock)), holdMilli);
        }        
    }
}

void LevelTracker::prepare(const int channels, const int sampleRate, const int latencyInSamples, const int backlogSize)
{    
    samplesPerBlock = (int)(sampleRate * 0.1 / (double)backlogSize);

    levels.clear();
    levels.resize(channels, LevelInfo(sampleRate, latencyInSamples / samplesPerBlock + 1, backlogSize));
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

LevelTracker::LevelInfo::LevelInfo(int sampleRate, int resultSize, int backlogSize)
    :
    resultSize(resultSize),
    backlogSize(backlogSize),
    backlog(backlogSize, 0.0)
{

}

void LevelTracker::LevelInfo::setLevels(const int64 time, const double newLevel, const int64 newHoldMSecs)
{
    if (newLevel > 1.0) {
        clip = true;
    }

    auto avgPeak = getAverageLevel();

    if (avgPeak >= peak)
    {
        peak = jmin(1.0, avgPeak);
        hold = time + newHoldMSecs;
    }
    else if (time > hold)
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
    lv.clip = clip;
    lv.level = avgPeak;
    lv.peak = peak;

    results.push(lv);
    if (results.size() > (size_t)resultSize) {
        results.pop();
    }
}

LevelTracker::LevelInfo::Level LevelTracker::LevelInfo::read()
{
    return results.empty() ? Level() : results.front();
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
