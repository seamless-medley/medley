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

    LevelSmoother(int sampleRate, int backlogSize);

    LevelSmoother(const LevelSmoother& other);

    void addLevel(const Time time, const double newLevel, const RelativeTime hold);

    Level& get();

    void update(const Time time);
private:
    double getAverageLevel() const;

    void push(double level);

    int sampleRate;

    bool clip = false;
    double level = 0.0;
    double peak = 0.0;

    Time holdUntil{ 0 };
    int backlogSize = 0;
    std::vector<double> backlog;
    int backlogIndex = 0;

    Level results[128];
    std::atomic<uint8_t> results_head;
    std::atomic<uint8_t> results_tail = 0;

    Level currentResult{};
};
