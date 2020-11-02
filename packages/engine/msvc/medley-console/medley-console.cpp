#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

int main()
{
    ::CoInitialize(nullptr);

    using namespace juce;

    AudioDeviceManager adm;
    adm.initialise(0, 2, nullptr, true, {}, nullptr);

    ToneGeneratorAudioSource tone;
    tone.setFrequency(440);
    tone.setAmplitude(0.8);

    AudioFormatManager fmg;
    fmg.registerBasicFormats();

    MixerAudioSource mixer;
    mixer.addInputSource(&tone, false);

    AudioSourcePlayer player;
    player.setSource(&mixer);

    adm.addAudioCallback(&player);

    getchar();

    adm.closeAudioDevice();
}
