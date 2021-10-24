#include <JuceHeader.h>
#include "RingBuffer.h"

using namespace juce;

/**
 * Special audio source intended to be used with ResamplingAudioSource, to resampling samples in RingBuffer
 **/
class RingBufferAudioSource : public AudioSource
{
public:
    RingBufferAudioSource(RingBuffer<float>& buffer)
        : buffer(buffer)
    {

    }

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override { }

    void releaseResources() {}

    void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

private:
    RingBuffer<float>& buffer;
};