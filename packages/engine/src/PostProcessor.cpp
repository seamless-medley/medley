#include "PostProcessor.h"

PostProcessor::PostProcessor()
{
    chain.setBypassed<index::Karaoke>(false);
    chain.setBypassed<index::Limiter>(false);

    karaokeMix = getKaraokeParams(DeFXKaraoke::Param::Mix);
    karaokeMixFader.alwaysResetTime(true);
}

void PostProcessor::prepare(const ProcessSpec& spec, const int latencyInSamples) {
    buffer.setSize(2, spec.maximumBlockSize);
    levelTracker.prepare(spec.numChannels, (int)spec.sampleRate, latencyInSamples);
    chain.prepare(spec);
}

void PostProcessor::process(const AudioSourceChannelInfo& info, double timestamp) {
    currentTime = timestamp;

    if (karaokeMixFader.shouldUpdate(currentTime)) {
        chain.get<index::Karaoke>().setParam(
            DeFXKaraoke::Param::Mix,
            karaokeMixFader.update(currentTime)
        );
    }

    AudioBlock<float> block(
        info.buffer->getArrayOfWritePointers(),
        info.buffer->getNumChannels(),
        (size_t)info.startSample,
        (size_t)info.numSamples
    );

    chain.process(ProcessContextReplacing<float>(block));

    {
        ScopedLock sl(levelTrackerLock);
        levelTracker.process(info);
    }

    for (int i = info.buffer->getNumChannels(); --i >= 0;) {
        info.buffer->applyGainRamp(i, info.startSample, info.numSamples, lastVolume, volume);
    }

    lastVolume = volume;
}

void PostProcessor::reset() {
    chain.reset();
}

void PostProcessor::updateLevelTracker()
{
    ScopedLock sl(levelTrackerLock);
    levelTracker.update();
}

double PostProcessor::getLevel(int channel) const
{
    ScopedLock sl(levelTrackerLock);
    return levelTracker.getLevel(channel);
}

double PostProcessor::getPeak(int channel) const
{
    ScopedLock sl(levelTrackerLock);
    return levelTracker.getPeak(channel);
}

bool PostProcessor::isClipping(int channel) const
{
    ScopedLock sl(levelTrackerLock);
    return levelTracker.isClipping(channel);
}

float PostProcessor::getVolume() const
{
    return volume;
}

void PostProcessor::setVolume(float value)
{
    volume = value;
}

bool PostProcessor::isKaraokeEnabled() const {
    return karaokeEnabled;
}

bool PostProcessor::setKaraokeEnabled(bool enabled, bool dontTransit) {
    if (karaokeEnabled == enabled) {
        return true;
    }

    karaokeEnabled = enabled;

    if (dontTransit) {
        auto& fx = chain.get<index::Karaoke>();
        fx.setEnabled(karaokeEnabled);
        fx.setParam(DeFXKaraoke::Param::Mix, karaokeMix);
        return fx.isEnabled();
    }

    auto start = currentTime + 100;
    auto end = start + 600;

    if (karaokeEnabled) {
        chain.get<index::Karaoke>().setEnabled(true);

        karaokeMixFader.start(start, end, 0.0f, karaokeMix, 0.7f, karaokeMix, [=] {
            // Ensure resetting to the up-to-date value
            karaokeMixFader.reset(karaokeMix);
            chain.get<index::Karaoke>().setParam(DeFXKaraoke::Param::Mix, karaokeMix);
        });

        return chain.get<index::Karaoke>().isEnabled();
    }
    else {
        karaokeMixFader.start(start, end, karaokeMix, 0.0f, 0.7f, karaokeMix, [=] {
            karaokeMixFader.reset(0.0f);

            auto& fx = chain.get<index::Karaoke>();
            fx.setParam(DeFXKaraoke::Param::Mix, 0.0f);
            fx.setEnabled(false);
        });

        return true;
    }
}

float PostProcessor::getKaraokeParams(DeFXKaraoke::Param param) const {
    return chain.get<index::Karaoke>().getParam(param);
}

float PostProcessor::setKaraokeParams(DeFXKaraoke::Param param, float newValue) {
    auto result = chain.get<index::Karaoke>().setParam(param, newValue);

    if (param == DeFXKaraoke::Param::Mix) {
        karaokeMix = result;
    }

    return result;
}
