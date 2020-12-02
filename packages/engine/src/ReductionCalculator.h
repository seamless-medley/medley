#pragma once

// Adapted from https://github.com/DanielRudrich/SimpleCompressor

#include <JuceHeader.h>

class ReductionCalculator
{
public:
    void prepare(const double newSampleRate);

    void calculateDecibels(const float* signal, float* result, const int numSamples);

    void calculateLinear(const float* signal, float* result, const int numSamples);

    void setRatio(const float ratio);

    void setMakeUpGain(const float makeUpGainInDecibels) {
        makeUpGain = makeUpGainInDecibels;
    }

    const float getMakeUpGain() const { return makeUpGain; }

    void setThreshold(const float thresholdInDecibels) {
        threshold = thresholdInDecibels;
    }

    const float getThreshold() const { return threshold; }

    void setKnee(const float kneeInDecibels) {
        knee = kneeInDecibels;
        kneeHalf = knee / 2.0f;
    }

    const float getKnee() const { return knee; }

    void setAttackTime(const float attackTimeInSeconds) {
        attackTime = attackTimeInSeconds;
        alphaAttack = 1.0f - timeToGain(attackTime);
    }

    void setReleaseTime(const float releaseTimeInSeconds) {
        releaseTime = releaseTimeInSeconds;
        alphaRelease = 1.0f - timeToGain(releaseTime);
    }

private:
    const float timeToGain(const float timeInSeconds);
    const float apply(const float overShootInDecibels);

    std::atomic<float> maxInputLevel{ -std::numeric_limits<float>::infinity() };
    std::atomic<float> maxGainReduction{ 0 };

    double sampleRate;

    float knee = 0.0f;
    float kneeHalf = 0.0f;
    float threshold = -10.0f;
    float attackTime = 0.01f;
    float releaseTime = 0.15f;
    float slope;
    float makeUpGain = 0.0f;

    float state = 0.0f;

    float alphaAttack;
    float alphaRelease;
};

