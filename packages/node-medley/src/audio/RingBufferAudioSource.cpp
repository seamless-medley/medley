#include "RingBufferAudioSource.h"

void RingBufferAudioSource::getNextAudioBlock(const AudioSourceChannelInfo& info) {
    auto numSamples = jmin(info.numSamples, buffer.getNumReady());
    buffer.read(*info.buffer, numSamples);
}