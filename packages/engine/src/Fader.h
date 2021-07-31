#pragma once

#include <JuceHeader.h>

class Fader
{
public:
    typedef std::function<void(void)> OnDone;

    Fader(float normalGain = -1.0f);

    inline float getGain() const { return gain; }
    inline void setGain(float f) { gain = f; }

    inline double getTimeStart() const { return timeStart; }
    inline double getTimeEnd() const { return timeEnd; }

    void start(double timeStart, double timeEnd, float from, float to, float factor = 2.0f, float resetTo = -1.0f, OnDone callback = []() {});
    float start(double time, double timeStart, double timeEnd, float from, float to, float factor = 2.0f, OnDone callback = []() {});
    float update(double time);
    void stop();
    void reset(float toGain = -1.0f);
private:
    float normalGain;
    float gain;

    double timeStart = -1.0;
    double timeEnd = -1.0;
    float from = 0.0f;
    float to = 0.0f;
    float factor = 1.0f;

    float resetTo = -1.0f;

    bool fadeOut = false;

    OnDone callback;
};
