#include "LevelSmoother.h"

namespace {
    constexpr auto kPeakDecayRate = 0.125;
}


LevelSmoother::LevelSmoother(int sampleRate, int backlogSize)
    :
    sampleRate(sampleRate), backlogSize(backlogSize), backlog(backlogSize, 0.0)
{

}

LevelSmoother::LevelSmoother(const LevelSmoother& other)
    : sampleRate(other.sampleRate), backlogSize(other.backlogSize), backlog(backlogSize, 0.0),
    results_head(0), results_tail(0)
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
        auto diff = time - holdUntil;
        peak = Decibels::decibelsToGain(Decibels::gainToDecibels(peak) - jlimit(0.0, 1.0, kPeakDecayRate * diff.inSeconds()));
        clip = peak > 1.0;
    }

    push(newLevel);

    avgPeak = getAverageLevel();
    if (peak < avgPeak) {
        peak = avgPeak;
    }
    
    auto h = results_head.load(std::memory_order_relaxed);
    if ((h - results_tail.load(std::memory_order_acquire)) != 128) {
        results[h++ & 127] = { time, clip, avgPeak, peak };
        std::atomic_signal_fence(std::memory_order_release);
        results_head.store(h, std::memory_order_release);
    }
}

LevelSmoother::Level& LevelSmoother::get()
{
    return currentResult;
}

void LevelSmoother::update(const Time time)
{
    auto t = results_tail.load(std::memory_order_relaxed);
    while (t != results_head.load(std::memory_order_acquire)) {
        auto first = results[t & 127];

        if (time <= first.time) {
            break;
        }        

        currentResult.level = (first.level + currentResult.level) * 0.5;
        currentResult.peak = (first.peak + currentResult.peak) * 0.5;
        currentResult.clip |= first.clip;

        t++;
        std::atomic_signal_fence(std::memory_order_release);
        results_tail.store(t, std::memory_order_release);
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