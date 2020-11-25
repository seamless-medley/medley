#include "LevelTracker.h"

void LevelTracker::process(AudioSampleBuffer& buffer)
{
    lastMeasurement = Time::currentTimeMillis();

    const auto numChannels = buffer.getNumChannels();
    const auto numSamples = buffer.getNumSamples();

    for (int channel = 0; channel < std::min(numChannels, int(levels.size())); ++channel) {
        levels[size_t(channel)].setLevels(lastMeasurement, buffer.getMagnitude(channel, 0, numSamples), holdMilli);
    }
}

void LevelTracker::prepare(const int channels, const int backlogSize)
{
    levels.resize(channels, LevelInfo(backlogSize));
}

double LevelTracker::getLevel(int channel) const {
    return channel < (int)levels.size() ? levels[channel].getAverageLevel() : 0.0;
}

double LevelTracker::getPeak(int channel) const
{
    return channel < (int)levels.size() ? levels[channel].peak : 0.0;
}

LevelTracker::LevelInfo::LevelInfo(int backlogSize)
    :
    backlog(backlogSize, 0.0)
{

}

void LevelTracker::LevelInfo::setLevels(const int64 time, const double newLevel, const int64 newHoldMSecs)
{
    if (newLevel > 1.0) {
        clip = true;
    }

    auto newPeak = getAverageLevel();

    if (newPeak >= peak)
    {
        peak = jmin(1.0, newPeak);
        hold = time + newHoldMSecs;
    }
    else if (time > hold)
    {      
        peak -= (time - hold) / 1000;
        if (peak < level) {
            peak = level;
        }

        clip = peak > 1.0;
    }

    push(jmin(1.0, newLevel));
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
