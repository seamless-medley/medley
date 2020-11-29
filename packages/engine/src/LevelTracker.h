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

    void update();

private:
    struct Level {
        Time time{ 0 };
        bool clip = false;
        double level = 0.0;
        double peak = 0.0;
    };

    class LevelInfo : public Level {
    public:
        LevelInfo(int sampleRate, int resultSize, int backlogSize);

        double getAverageLevel() const;

        void setLevels(const Time time, const double newLevel, const RelativeTime hold);

        Level& read();

        void update(const Time time);

        friend class LevelTracker;
    private:

        void push(double level);

        Time holdUntil{ 0 };
        int backlogSize;        
        std::vector<double> backlog;
        int backlogIndex = 0;

        int resultSize = 1;
        std::queue<Level> results;

        Level currentResult{};
    };

    int sampleRate = 44100;
    int samplesPerBlock = 441;
    int64 samplesProcessed = 0;

    std::vector<LevelInfo> levels;    

    RelativeTime holdDuration{ 0.5 };
    Time lastMeasurement;
    RelativeTime latency{ 0 };
};

