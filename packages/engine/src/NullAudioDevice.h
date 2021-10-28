#pragma once

#include <JuceHeader.h>

using namespace juce;

class NullAudioDeviceType : public AudioIODeviceType {
public:
    NullAudioDeviceType();

    void scanForDevices() override {}

    StringArray getDeviceNames(bool wantInputNames) const override;

    int getDefaultDeviceIndex(bool /*forInput*/) const override {
        return 0;
    }

    int getIndexOfDevice(AudioIODevice* device, bool asInput) const override;

    bool hasSeparateInputsAndOutputs() const override { return true; }

    AudioIODevice* createDevice(const String& outputDeviceName, const String& inputDeviceName) override;
};

/**
 * NullAudioDevice only support strero output (2 channels)
 * And does not support input, since nulled input just make no senses
 */
class NullAudioDevice : public AudioIODevice, public Thread {
public:
    NullAudioDevice();
    ~NullAudioDevice();

    String open(const BigInteger& inputChannels, const BigInteger& outputChannels, double newSampleRate, int newBufferSize) override;
    void close() override;

    Array<double> getAvailableSampleRates() override {
        return { 48000.0 };
    }

    Array<int> getAvailableBufferSizes() override {
        return { 480 };
    }

    int getDefaultBufferSize() override { return 480; }

    int getCurrentBitDepth() override {
        return 32;
    }    

    int getCurrentBufferSizeSamples() override { return 480; }

    double getCurrentSampleRate() override { return 48000.0; }

    BigInteger getActiveOutputChannels() const override {
        return BigInteger(2);
    }

    BigInteger getActiveInputChannels() const override {
        return BigInteger(0);
    }

    int getOutputLatencyInSamples() override { return 480; }

    int getInputLatencyInSamples() override { return 0; }

    StringArray getOutputChannelNames() override {
        return StringArray("Left", "Right");
    }

    StringArray getInputChannelNames() override {
        return StringArray();
    }

    void start(AudioIODeviceCallback* call) override;
    void stop() override;

    bool isOpen() override;

    bool isPlaying() override;

    String getLastError() override {
        return String();
    }
    // Thread
    void run() override;

private:
    bool isOpen_ = false;
    bool isStarted = false;

    AudioIODeviceCallback* callback = {};
    CriticalSection startStopLock;
};