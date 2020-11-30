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

    LevelSmoother(int sampleRate, int resultSize, int backlogSize);

    void addLevel(const Time time, const double newLevel, const RelativeTime hold);

    Level& get();

    void update(const Time time);
private:
    double getAverageLevel() const;

    void push(double level);

    bool clip = false;
    double level = 0.0;
    double peak = 0.0;

    Time holdUntil{ 0 };
    int backlogSize;
    std::vector<double> backlog;
    int backlogIndex = 0;

    int resultSize = 1;
    std::queue<Level> results;

    Level currentResult{};
};
