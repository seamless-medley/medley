#pragma once

#include <JuceHeader.h>

using namespace juce;

class LevelSmoother {
public:
    struct Level {
        Time time{ 0 };
        bool clip = false;
        double level = 0.0;
        double peak = 0.0;
    };

    LevelSmoother(int sampleRate);

    //LevelSmoother(const LevelSmoother& other);

    void addLevel(const Time time, const double newLevel, const RelativeTime hold);

    Level& get();

    void update(const Time time);
private:
    double getAverageLevel();

    void push(double level);

    int sampleRate;

    bool clip = false;
    double level = 0.0;
    double peak = 0.0;

    Time holdUntil{ 0 };

    double backlog[10]{};
    std::atomic<uint8_t> backlog_write = 0;

    Level results[128];
    std::atomic<uint8_t> results_write;
    std::atomic<uint8_t> results_read = 0;

    Level currentResult{};
};
