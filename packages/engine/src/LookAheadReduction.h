#pragma once

// Adapted from https://github.com/DanielRudrich/SimpleCompressor

#include <JuceHeader.h>

class LookAheadReduction
{
public:
    void setDelayTime(float delayTimeInSeconds);

    const int getDelayInSamples() const { return delayInSamples; }
    
    void prepare(const double newSampleRate, const int newBlockSize);

    void pushSamples(const float* src, const int numSamples);

    void process();

    void readSamples(float* dest, const int numSamples);

private:
    inline void getProcessPositions(int startIndex, int numSamples, int& blockSize1, int& blockSize2);

    inline void getWritePositions(int numSamples, int& startIndex, int& blockSize1, int& blockSize2);

    inline void getReadPositions(int numSamples, int& startIndex, int& blockSize1, int& blockSize2);

    double sampleRate;
    int blockSize;

    float delay;
    int delayInSamples = 0;
    int writePosition = 0;
    int lastPushedSamples = 0;
    std::vector<float> buffer;
};

