#pragma once

#include <JuceHeader.h>

using namespace juce;

class TrackBuffer : public AudioTransportSource {
public:
    class Callback {
    public:
        virtual void finished() = 0;

        virtual void unloaded() = 0;
    };

    TrackBuffer(AudioFormatManager& formatMgr, TimeSliceThread& readAheadThread);

    ~TrackBuffer();

    void loadTrack(const File& file);

    void unloadTrack();

    inline bool isTrackLoaded() const { return reader != nullptr; }

    void setPositionFractional(double fraction);

    void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

private:
    AudioFormatManager& formatMgr;
    TimeSliceThread& readAheadThread;

    AudioFormatReader* reader = nullptr;
    AudioFormatReaderSource* formatSource = nullptr;
    //
    ListenerList<Callback> listeners;
};

