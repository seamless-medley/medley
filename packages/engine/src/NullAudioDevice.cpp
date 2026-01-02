#include "NullAudioDevice.h"
#include <thread>
#include <chrono>

NullAudioDeviceType::NullAudioDeviceType()
    : AudioIODeviceType("Null")
{

}

StringArray NullAudioDeviceType::getDeviceNames(bool wantInputNames) const {
    return wantInputNames ? StringArray() : StringArray("Null Device");
}

int NullAudioDeviceType::getIndexOfDevice(AudioIODevice* device, bool asInput) const {
    return asInput ? -1 : 0;
}

AudioIODevice* NullAudioDeviceType::createDevice(const String& outputDeviceName, const String& inputDeviceName) {
    return new NullAudioDevice();
}

NullAudioDevice::NullAudioDevice()
    : AudioIODevice("Null Device", "Null"),
      Thread("Medley Null Device Thread")
{

}

NullAudioDevice::~NullAudioDevice()
{
    close();
}

String NullAudioDevice::open(const BigInteger& inputChannels, const BigInteger& outputChannels, double newSampleRate, int newBufferSize)
{
    startThread(8);
    Thread::sleep(5);

    isOpen_ = true;
    return String(); // No error
}

void NullAudioDevice::close()
{
    stop();
    signalThreadShouldExit();

    stopThread(5000);

    isOpen_ = false;
}

void NullAudioDevice::start(AudioIODeviceCallback* call)
{
    if (isOpen_ && call != nullptr && !isStarted)
    {
        if (!isThreadRunning())
        {
            isOpen_ = false;
            return;
        }

        call->audioDeviceAboutToStart(this);

        const ScopedLock sl(startStopLock);
        callback = call;
        isStarted = true;
    }
}

void NullAudioDevice::stop()
{
    if (isStarted)
    {
        auto* callbackLocal = callback;

        {
            const ScopedLock sl(startStopLock);
            isStarted = false;
        }

        if (callbackLocal != nullptr)
            callbackLocal->audioDeviceStopped();
    }
}

bool NullAudioDevice::isOpen()
{
    return isOpen_ && isThreadRunning();
}

bool NullAudioDevice::isPlaying()
{
    return isStarted && isThreadRunning();
}

void NullAudioDevice::run()
{
    using seconds_t = double;

    constexpr seconds_t const frameDuration(480.0 / 48000.0);
    constexpr seconds_t const timeToWait(frameDuration / 2);

    constexpr seconds_t dropout = 0.3;

    auto nowInSeconds = [] {
        return std::chrono::duration<double>(
            std::chrono::high_resolution_clock::now().time_since_epoch()
        ).count();
    };

    AudioBuffer<float> ins(0, 480 + 32);
    AudioBuffer<float> outs(2, 480 + 32);
    auto inputBuffers = ins.getArrayOfWritePointers();
    auto outputBuffers = outs.getArrayOfWritePointers();

    seconds_t last = nowInSeconds();

    while (!threadShouldExit()) {
        seconds_t const now = nowInSeconds();
        seconds_t const diff = now - last;

        if (diff >= dropout) {
            last = now;
            continue;
        }

        if (diff >= frameDuration) {
            const ScopedTryLock sl(startStopLock);

            if (callback) {
                callback->audioDeviceIOCallbackWithContext(
                    const_cast<const float**>(inputBuffers), 0,
                    outputBuffers, 2,
                    480,
                    {}
                );
            }

            last += frameDuration;
            continue;
        }

        std::this_thread::sleep_for(std::chrono::duration<seconds_t>(timeToWait));
    }
}
