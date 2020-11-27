#pragma once

#include <JuceHeader.h>

using namespace juce;

class LevelTracker
{
public:
    void process(AudioSampleBuffer& buffer);

    void prepare(const int channels, const int sampleRate, const int latencyInSamples, const int backlogSize);

    double getLevel(int channel);

    double getPeak(int channel);

    bool isClipping(int channel);

private:
    struct Level {
        bool clip = false;
        double level = 0.0;
        double peak = 0.0;
    };

    class LevelInfo : public Level {
    public:
        LevelInfo(int sampleRate, int resultSize, int backlogSize);

        double getAverageLevel() const;

        void setLevels(const int64 time, const double newLevel, const int64 newHoldMSecs);

        Level read();

        friend class LevelTracker;
    private:

        void push(double level);

        int64 hold = 0;
        int backlogSize;        
        std::vector<double> backlog;
        int backlogIndex = 0;

        int resultSize = 1;
        std::queue<Level> results;
    };

    int samplesPerBlock = 440;

    std::vector<LevelInfo> levels;    

    int64 holdMilli = 500;
    int64 lastMeasurement = 0;
};

