#pragma once

#include <JuceHeader.h>

using namespace juce;

template <typename SampleType>
class RingBuffer
{
public:
    RingBuffer::RingBuffer(int numChannels, int numSamples)
        :
        numChannels(numChannels),
        numSamples(numSamples),
        audioData(numChannels, numSamples),
        fifo(numSamples)
    {

    }

    RingBuffer(const RingBuffer& other)
        :
        numChannels(other.numChannels),
        fifo(other.fifo.getTotalSize())
    {

    }

    RingBuffer(RingBuffer&& other)
        :
        numChannels(other.numChannels),
        fifo(other.fifo)
    {

    }

    int write(const AudioBuffer<SampleType>& source, int startSample, int numSamples)
    {
        auto numToDo = jmin(this->numSamples, numSamples);

        if (fifo.getFreeSpace() <= 0) {
            fifo.reset();
        }

        auto w = fifo.write(numToDo);

        auto channels = jmin(source.getNumChannels(), numChannels);

        for (int i = 0; i < numChannels; i++) {
            auto src = source.getReadPointer(i, startSample);
            auto dest = audioData.getWritePointer(i);

            if (w.blockSize1 > 0) {
                FloatVectorOperations::copy(dest + w.startIndex1, src, w.blockSize1);
            }

            if (w.blockSize2 > 0) {
                FloatVectorOperations::copy(dest + w.startIndex2, src + w.blockSize1, w.blockSize2);
            }
        }

        return w.blockSize1 + w.blockSize2;
    }

    int read(AudioBuffer<SampleType>& dest, int numSamples)
    {
        auto numToDo = jmin(fifo.getNumReady(), dest.getNumSamples(), numSamples);
        auto channels = jmin(dest.getNumChannels(), numChannels);

        auto r = fifo.read(numToDo);

        for (int i = 0; i < numChannels; i++) {
            if (r.blockSize1 > 0) {
                dest.copyFrom(i, 0, audioData, i, r.startIndex1, r.blockSize1);
            }

            if (r.blockSize2 > 0) {
                dest.copyFrom(i, r.blockSize1, audioData, i, r.startIndex2, r.blockSize2);
            }
        }

        return r.blockSize1 + r.blockSize2;
    }

    int getNumReady() const { return fifo.getNumReady(); }

private:
    int numChannels;
    int numSamples;

    AudioBuffer<SampleType> audioData;
    AbstractFifo fifo;
};