#pragma once

#include <JuceHeader.h>

using namespace juce;

// TODO: Implement AudioSource as composition
class TrackBuffer : public AudioTransportSource {
public:
    class Callback {
    public:
        virtual void finished(TrackBuffer& sender) = 0;

        virtual void unloaded(TrackBuffer& sender) = 0;
    };

    TrackBuffer(AudioFormatManager& formatMgr, TimeSliceThread& readAheadThread);

    ~TrackBuffer();

    void loadTrack(const File& file);

    void unloadTrack();

    inline bool isTrackLoaded() const { return reader != nullptr; }

    void setPositionFractional(double fraction);

    void getNextAudioBlock(const AudioSourceChannelInfo& info) override;

    void addListener(Callback* cb) {
        listeners.add(cb);
    }

private:
    AudioFormatManager& formatMgr;
    TimeSliceThread& readAheadThread;

    AudioFormatReader* reader = nullptr;
    AudioFormatReaderSource* formatSource = nullptr;
    //
    ListenerList<Callback> listeners;
};

