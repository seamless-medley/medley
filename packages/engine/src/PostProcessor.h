#pragma once

#include <JuceHeader.h>

#include "DeFXKaraoke.h"
#include "Fader.h"
#include "LookAheadLimiter.h"
#include "LevelTracker.h"

using namespace juce::dsp;

namespace medley {
    namespace processor {
        namespace index {
            constexpr auto DeFX = 0;
            constexpr auto Limiter = 1;
        }
    }
}

using namespace medley::processor;

class KaraokeParamController {
public:
    virtual bool isKaraokeEnabled() const = 0;

    virtual bool setKaraokeEnabled(bool enabled, bool dontTransit = false) = 0;

    virtual float getKaraokeParams(DeFXKaraoke::Param param) const = 0;

    virtual float setKaraokeParams(DeFXKaraoke::Param param, float newValue) = 0;
};

class PostProcessor : public KaraokeParamController {
public:
    PostProcessor();

    void prepare(const ProcessSpec& spec, const int latencyInSamples);

    void process(const AudioSourceChannelInfo& info, double timestamp);

    void reset();

    void updateLevelTracker();

    double getLevel(int channel) const;

    double getPeak(int channel) const;

    bool isClipping(int channel) const;

    /**
     * Reduction in dB
     */
    inline float getReduction() const { return chain.get<1>().getReduction(); }

    float getVolume() const;

    void setVolume(float value);

    bool isKaraokeEnabled() const override;

    bool setKaraokeEnabled(bool enabled, bool dontTransit = false) override;

    float getKaraokeParams(DeFXKaraoke::Param param) const override;

    float setKaraokeParams(DeFXKaraoke::Param param, float newValue) override;

private:
    double currentTime = 0.0;

    juce::AudioBuffer<float> buffer;

    CriticalSection levelTrackerLock;
    LevelTracker levelTracker;

    ProcessorChain<DeFXKaraoke, LookAheadLimiter> chain;

    float volume = 1.0f;
    float lastVolume = 1.0f;

    bool karaokeEnabled = false;
    Fader karaokeMixFader;
    float karaokeMix = 0.0f;
};
