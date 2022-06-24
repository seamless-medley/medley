#include "LookAheadLimiter.h"

// Adapted from https://github.com/DanielRudrich/SimpleCompressor

using namespace juce;

LookAheadLimiter::LookAheadLimiter()
{
    gainReductionCalculator.setThreshold(-6.0f);
    gainReductionCalculator.setKnee(0.0f);
    gainReductionCalculator.setAttackTime(10.0f / 1000);
    gainReductionCalculator.setReleaseTime(60.0f / 1000);
    gainReductionCalculator.setMakeUpGain(0.0f);

    const float ratio = 16.0f;
    if (ratio > 15.9f)
        gainReductionCalculator.setRatio(std::numeric_limits<float>::infinity());
    else
        gainReductionCalculator.setRatio(ratio);

    delay.setDelayTime(0.005f);
    lookAheadFadeIn.setDelayTime(0.005f);
}

void LookAheadLimiter::prepare(const ProcessSpec& spec)
{
    gainReductionCalculator.prepare(spec.sampleRate);
    lookAheadFadeIn.prepare(spec.sampleRate, spec.maximumBlockSize);

    delay.prepare({ spec.sampleRate, static_cast<uint32> (spec.maximumBlockSize), 2 });

    sideChainBuffer.setSize(2, spec.maximumBlockSize);
}

void LookAheadLimiter::process(const ProcessContextReplacing<float>& context)
{
    ScopedNoDenormals noDenormals;

    auto& input = context.getInputBlock();
    auto& output = context.getOutputBlock();

    auto totalNumInputChannels = input.getNumChannels();
    auto totalNumOutputChannels = output.getNumChannels();

    const int numSamples = input.getNumSamples();

    // clear not needed output channels
    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        output.getSingleChannelBlock(i).clear();

    /** STEP 1: compute sidechain-signal */
    // copy the absolute values from the first input channel to the sideChainBuffer
    FloatVectorOperations::abs(sideChainBuffer.getWritePointer(0), input.getChannelPointer(0), numSamples);

    // copy all other channels to the second channel of the sideChainBuffer and write the maximum of both channels to the first one
    for (unsigned long ch = 1; ch < totalNumInputChannels; ++ch)
    {
        FloatVectorOperations::abs(sideChainBuffer.getWritePointer(1), input.getChannelPointer(ch), numSamples);
        FloatVectorOperations::max(sideChainBuffer.getWritePointer(0), sideChainBuffer.getReadPointer(0), sideChainBuffer.getReadPointer(1), numSamples);
    }

    /** STEP 2: calculate gain reduction, which one depends on lookAhead */
    gainReductionCalculator.calculateDecibels(sideChainBuffer.getReadPointer(0), sideChainBuffer.getWritePointer(1), numSamples);

    /** STEP 3: fade-in gain reduction if look-ahead is enabled */

    // delay audio signal
    //AudioBlock<float> ab(output);
    //ProcessContextReplacing<float> delayCtx(ab);
    delay.process(context);

    // fade in gain reduction
    lookAheadFadeIn.pushSamples(sideChainBuffer.getReadPointer(1), numSamples);
    lookAheadFadeIn.process();
    lookAheadFadeIn.readSamples(sideChainBuffer.getWritePointer(1), numSamples);

    // add make-up and convert to linear gain
    const float makeUpGainInDecibels = gainReductionCalculator.getMakeUpGain();
    for (int i = 0; i < numSamples; ++i)
        sideChainBuffer.setSample(1, i, Decibels::decibelsToGain(sideChainBuffer.getSample(1, i) + makeUpGainInDecibels));


    /** STEP 4: apply gain-reduction to all channels */
    auto reduction = 0.0f;

    for (int i = 0; i < numSamples; ++i)
        reduction += sideChainBuffer.getSample(1, i);

    this->reduction = Decibels::gainToDecibels(reduction / numSamples);

    for (unsigned long ch = 0; ch < totalNumInputChannels; ++ch)
        FloatVectorOperations::multiply(output.getChannelPointer(ch), sideChainBuffer.getReadPointer(1), numSamples);
}

void LookAheadLimiter::reset()
{

}

void LookAheadLimiter::Delay::prepare(const ProcessSpec& spec)
{
    this->spec = spec;

    delayInSamples = static_cast<int> (delayPeriod * spec.sampleRate);

    buffer.setSize(spec.numChannels, spec.maximumBlockSize + delayInSamples);
    buffer.clear();
    writePosition = 0;
}

void LookAheadLimiter::Delay::process(const ProcessContextReplacing<float>& context)
{
    ScopedNoDenormals noDenormals;

    if (!bypassed)
    {
        auto abIn = context.getInputBlock();
        auto abOut = context.getOutputBlock();
        auto L = static_cast<int> (abIn.getNumSamples());
        auto nCh = jmin((int)spec.numChannels, (int)abIn.getNumChannels());

        int startIndex, blockSize1, blockSize2;


        // write in delay line
        getReadWritePositions(false, (int)L, startIndex, blockSize1, blockSize2);

        for (int ch = 0; ch < nCh; ch++)
            buffer.copyFrom(ch, startIndex, abIn.getChannelPointer(ch), blockSize1);

        if (blockSize2 > 0)
            for (int ch = 0; ch < nCh; ch++)
                buffer.copyFrom(ch, 0, abIn.getChannelPointer(ch) + blockSize1, blockSize2);


        // read from delay line
        getReadWritePositions(true, (int)L, startIndex, blockSize1, blockSize2);

        for (int ch = 0; ch < nCh; ch++)
            FloatVectorOperations::copy(abOut.getChannelPointer(ch), buffer.getReadPointer(ch) + startIndex, blockSize1);

        if (blockSize2 > 0)
            for (int ch = 0; ch < nCh; ch++)
                FloatVectorOperations::copy(abOut.getChannelPointer(ch) + blockSize1, buffer.getReadPointer(ch), blockSize2);


        writePosition += L;
        writePosition = writePosition % buffer.getNumSamples();
    }
}

void LookAheadLimiter::Delay::getReadWritePositions(bool read, int numSamples, int& startIndex, int& blockSize1, int& blockSize2)
{
    const int L = buffer.getNumSamples();
    int pos = writePosition;
    if (read)
    {
        pos = writePosition - delayInSamples;
    }
    if (pos < 0)
        pos = pos + L;
    pos = pos % L;

    jassert(pos >= 0 && pos < L);

    if (numSamples <= 0)
    {
        startIndex = 0;
        blockSize1 = 0;
        blockSize2 = 0;
    }
    else
    {
        startIndex = pos;
        blockSize1 = jmin(L - pos, numSamples);
        numSamples -= blockSize1;
        blockSize2 = numSamples <= 0 ? 0 : numSamples;
    }
}

void LookAheadLimiter::Delay::setDelayTime(float delayTimeInSeconds)
{
    if (delayTimeInSeconds <= 0.0f)
    {
        delayPeriod = 0.0f;
        bypassed = true;
    }
    else
    {
        delayPeriod = delayTimeInSeconds;
        bypassed = false;
    }

    prepare(spec);
}
