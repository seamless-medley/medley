#include "ReductionCalculator.h"

// Adapted from https://github.com/DanielRudrich/SimpleCompressor

using namespace juce;

void ReductionCalculator::prepare(const double newSampleRate)
{
    sampleRate = newSampleRate;

    alphaAttack = 1.0f - timeToGain(attackTime);
    alphaRelease = 1.0f - timeToGain(releaseTime);
}

void ReductionCalculator::calculateDecibels(const float* signal, float* result, const int numSamples)
{
    maxInputLevel = -std::numeric_limits<float>::infinity();
    maxGainReduction = 0.0f;

    for (int i = 0; i < numSamples; i++) {
        const float levelInDecibels = Decibels::gainToDecibels(signal[i]);

        if (levelInDecibels > maxInputLevel) {
            maxInputLevel = levelInDecibels;
        }

        const float overShoot = levelInDecibels - threshold;
        const float gainReduction = apply(overShoot);

        const float diff = gainReduction - state;
        if (diff < 0.0f) {
            state += alphaAttack * diff;
        } 
        else {
            state += alphaRelease * diff;
        }

        result[i] = state;

        if (state < maxGainReduction) {
            maxGainReduction = state;
        }
    }
}

void ReductionCalculator::calculateLinear(const float* signal, float* result, const int numSamples)
{
    calculateDecibels(signal, result, numSamples);
    for (int i = 0; i < numSamples; i++) {
        result[i] = Decibels::decibelsToGain(result[i] + makeUpGain);
    }
}

inline const float ReductionCalculator::timeToGain(const float timeInSeconds)
{
    return std::exp(-1.0f / (static_cast<float> (sampleRate) * timeInSeconds));
}

inline const float ReductionCalculator::apply(const float db)
{
    if (db <= -kneeHalf) {
        return 0.0f;
    }

    if (db > -kneeHalf && db <= kneeHalf) {
        return 0.5f * slope * (db + kneeHalf) * (db + kneeHalf) / knee;
    }

    return slope * db;
}

void ReductionCalculator::setRatio(const float ratio)
{
    slope = 1.0f / ratio - 1.0f;
}
