#pragma once

#include <JuceHeader.h>

using namespace juce;

class LevelTracker
{
public:
    void process(AudioSampleBuffer& buffer);

    void prepare(const int channels, const int backlogSize);

    double getLevel(int channel) const;

    double getPeak(int channel) const;

private:   
    class LevelInfo {
    public:
        LevelInfo(int backlogSize);        

        double getAverageLevel() const;

        void setLevels(const int64 time, const double newLevel, const int64 newHoldMSecs);

        friend class LevelTracker;
    private:        
        void push(double level);

        bool clip = false;
        int64 hold = 0;

        double level = 0.0;
        double peak = 0.0;
        double holdingPeak = 0.0;
        std::vector<double> backlog;
        int index = 0;
    };

    std::vector<LevelInfo> levels;

    int64 holdMilli = 500;
    int64 lastMeasurement = 0;
};

