#include "LevelTracker.h"

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

void LevelTracker::prepare(const int channels, const int sampleRate, const int backlogSize)
{    
    samplesPerBlock = sampleRate * 0.1 / (double)backlogSize;
    levels.resize(channels, LevelInfo(sampleRate, backlogSize));
}

double LevelTracker::getLevel(int channel) const {
    return channel < (int)levels.size() ? levels[channel].getAverageLevel() : 0.0;
}

double LevelTracker::getPeak(int channel) const
{
    return channel < (int)levels.size() ? levels[channel].peak : 0.0;
}

bool LevelTracker::isClipping(int channel) const
{
    return channel < (int)levels.size() ? levels[channel].clip : false;
}

LevelTracker::LevelInfo::LevelInfo(int sampleRate, int backlogSize)
    :
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
        // e/pi
        peak -= 0.00865255979432265087217774789646;
        clip = peak > 1.0;
    }

    push(jmin(1.0, newLevel));

    avgPeak = getAverageLevel();
    if (peak < avgPeak) {
        peak = avgPeak;
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
        backlog[index] = level;
        index = (index + 1) % backlog.size();
    }
    else
    {
        this->level = level;
    }
}
