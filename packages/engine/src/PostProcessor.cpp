#include "PostProcessor.h"

PostProcessor::PostProcessor()
{
    chain.setBypassed<index::DeFX>(true);
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
        chain.get<index::DeFX>().setParam(
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

void PostProcessor::setKaraokeEnabled(bool enabled, bool dontTransit) {
    if (karaokeEnabled == enabled) {
        return;
    }

    karaokeEnabled = enabled;

    if (dontTransit) {
        chain.setBypassed<index::DeFX>(!karaokeEnabled);
        chain.get<index::DeFX>().setParam(DeFXKaraoke::Param::Mix, karaokeMix);
        return;
    }

    auto start = currentTime + 100;
    auto end = start + 600;

    if (karaokeEnabled) {
        chain.setBypassed<index::DeFX>(false);

        karaokeMixFader.start(start, end, 0.0f, karaokeMix, 0.7f, karaokeMix, [=] {
            // Ensure resetting to the up-to-date value
            karaokeMixFader.reset(karaokeMix);
            chain.get<index::DeFX>().setParam(DeFXKaraoke::Param::Mix, karaokeMix);
        });
    }
    else {
        karaokeMixFader.start(start, end, karaokeMix, 0.0f, 0.7f, karaokeMix, [=] {
            karaokeMixFader.reset(0.0f);
            chain.get<index::DeFX>().setParam(DeFXKaraoke::Param::Mix, 0.0f);
            chain.setBypassed<index::DeFX>(true);
        });
    }
}

float PostProcessor::getKaraokeParams(DeFXKaraoke::Param param) const {
    return chain.get<index::DeFX>().getParam(param);
}

float PostProcessor::setKaraokeParams(DeFXKaraoke::Param param, float newValue) {
    auto result = chain.get<index::DeFX>().setParam(param, newValue);

    if (param == DeFXKaraoke::Param::Mix) {
        karaokeMix = result;
    }

    return result;
}
