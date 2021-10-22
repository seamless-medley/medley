#include "LevelSmoother.h"

namespace {
    constexpr auto kPeakDecayRate = 0.125;
}


LevelSmoother::LevelSmoother(int sampleRate)
    :
    sampleRate(sampleRate)
{

}

//LevelSmoother::LevelSmoother(const LevelSmoother& other)
//    : sampleRate(other.sampleRate),
//    backlog_write(0),
//    results_write(0), results_read(0)
//{
//
//}

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

    auto w = results_write.load(std::memory_order_relaxed);
    if ((w - results_read.load(std::memory_order_acquire)) != 128) {
        results[w++ & 127] = { time, clip, avgPeak, peak };
        std::atomic_signal_fence(std::memory_order_release);
        results_write.store(w, std::memory_order_release);
    }
}

LevelSmoother::Level& LevelSmoother::get()
{
    return currentResult;
}

void LevelSmoother::update(const Time time)
{
    auto r = results_read.load(std::memory_order_relaxed);
    while (r != results_write.load(std::memory_order_acquire)) {
        auto first = results[r & 127];

        if (time <= first.time) {
            break;
        }

        currentResult.level = (first.level + currentResult.level) * 0.5;
        currentResult.peak = (first.peak + currentResult.peak) * 0.5;
        currentResult.clip |= first.clip;

        r++;
        std::atomic_signal_fence(std::memory_order_release);
        results_read.store(r, std::memory_order_release);
    }

}

double LevelSmoother::getAverageLevel()
{
    auto acc = 0.0;
    int r = 0;
    while (r < 10) {
        auto level = backlog[r++ % 10];
        acc += level;
    }

    return acc / 10.0;
}

void LevelSmoother::push(double level) {
    auto w = backlog_write.load(std::memory_order_relaxed);
    backlog[w++ % 10] = level;
    std::atomic_signal_fence(std::memory_order_release);
    backlog_write.store(w, std::memory_order_release);
}