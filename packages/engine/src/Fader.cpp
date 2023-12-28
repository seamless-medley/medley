#include "Fader.h"

Fader::Fader(float normalValue)
    : normalValue(normalValue), value(normalValue)
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
    reversed = to < from;
    value = from;
    started = true;
}

float Fader::start(double time, double timeStart, double timeEnd, float from, float to, float factor, OnDone callback)
{
    start(timeStart, timeEnd, from, to, factor, -1.0f, callback);
    return update(time);
}

float Fader::update(double time)
{
    auto ng = normalValue != -1.0f ? normalValue : value;

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
            if (reversed) {
                value = (float)(pow(1 - progress, factor)) * (from - to) + to;
            }
            else {
                value = (float)pow(progress, factor) * (to - from) + from;
            }
        }
        else {
            value = to;
        }

        if (time >= timeEnd) {
            stop();
        }
    }

    return value;
}

bool Fader::shouldUpdate(double time)
{
    return started || (time >= timeStart) && (time <= timeEnd);
}

void Fader::stop()
{
    reset(resetTo);

    if (started) {
        started = false;
        callback();        
    }
}

void Fader::reset(float toValue)
{
    if (shouldResetTime) {
        resetTime();
    }

    auto g = toValue;
    if (g == -1.0f) {
        g = normalValue;
    }

    if (g != -1.0f) {
        value = g;
    }
}

void Fader::resetTime()
{
    timeStart = timeEnd = -1.0;
}

void Fader::alwaysResetTime(bool v)
{
    shouldResetTime = v;
}
