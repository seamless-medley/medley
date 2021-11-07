#include "Fader.h"

Fader::Fader(float normalGain)
    : normalGain(normalGain), gain(normalGain)
{
}

void Fader::start(double timeStart, double timeEnd, float from, float to, float factor, float resetTo, OnDone callback)
{
    this->timeStart = timeStart;
    this->timeEnd = timeEnd;
    this->from = from;
    this->to = to;
    this->factor = factor;
    this->callback = callback;
    this->resetTo = resetTo;
    fadeOut = to < from;
}

float Fader::start(double time, double timeStart, double timeEnd, float from, float to, float factor, OnDone callback)
{
    start(timeStart, timeEnd, from, to, factor, -1.0f, callback);
    return update(time);
}

float Fader::update(double time)
{
    auto ng = normalGain != -1.0f ? normalGain : gain;

    if (timeStart < 0 || timeEnd < 0) {
        return ng;
    }

    if (time < timeStart) {
        return ng;
    }

    if (time >= timeStart) {
        auto duration = timeEnd - timeStart;
        auto progress = juce::jlimit(0.0, 1.0, (time - timeStart) / duration);

        if (duration > 0.0) {
            if (fadeOut) {
                gain = (float)(pow(1 - progress, factor)) * (from - to) + to;
            }
            else {
                gain = (float)pow(progress, factor) * (to - from) + from;
            }
        }
        else {
            gain = to;
        }

        if (time >= timeEnd) {
            stop();
            if (resetTo != -1.0f) {
                gain = resetTo;
            }
        }
    }

    return gain;
}

void Fader::stop()
{
    reset(to);
    callback();
}

void Fader::reset(float toGain)
{
    timeStart = timeEnd = -1.0;

    auto g = toGain;
    if (g == -1.0f) {
        g = normalGain;
    }

    if (g != -1.0f) {
        gain = g;
    }
}
