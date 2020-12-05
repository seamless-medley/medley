#include "LevelSmoother.h"

namespace {
    constexpr auto kPeakDecayRate = 0.0086525;
}


LevelSmoother::LevelSmoother(int sampleRate, int resultSize, int backlogSize)
    :
    resultSize(resultSize),
    backlogSize(backlogSize),
    backlog(backlogSize, 0.0)
{

}

void LevelSmoother::addLevel(const Time time, const double newLevel, const RelativeTime hold)
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

    push(newLevel);

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

LevelSmoother::Level& LevelSmoother::get()
{
    return currentResult;
}

void LevelSmoother::update(const Time time)
{
    while (!results.empty()) {
        auto& first = results.front();

        if (time <= first.time) break;

        currentResult.level = (first.level + currentResult.level) * 0.5;
        currentResult.peak = (first.peak + currentResult.peak) * 0.5;
        currentResult.clip |= first.clip;

        results.pop();
    }
}

double LevelSmoother::getAverageLevel() const
{
    if (backlog.size() > 0) {
        return std::accumulate(backlog.begin(), backlog.end(), 0.0) / backlog.size();
    }

    return level;
}

void LevelSmoother::push(double level) {
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