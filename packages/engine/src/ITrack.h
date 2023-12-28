#pragma once

#include <JuceHeader.h>

using namespace juce;

namespace medley {
class ITrack : public ReferenceCountedObject {
public:
    virtual File getFile() = 0;

    virtual double getCueInPosition() { return -1.0; }

    virtual double getCueOutPosition() { return -1.0; }

    virtual bool getDisableNextTrackLeadIn() { return false; }

    using Ptr = ReferenceCountedObjectPtr<ITrack>;
};

class TrackPlay {
public:
    TrackPlay()
    {

    }

    TrackPlay(ITrack::Ptr track, double duration)
        :
        track(track),
        duration(duration)
    {

    }

    TrackPlay(const TrackPlay& other)
        :
        uuid(other.uuid),
        track(other.track),
        duration(other.duration)
    {

    }

    const Uuid& getUuid() const { return uuid; }
    ITrack::Ptr getTrack() const { return track; }
    double getDuration() const { return duration; }
private:
    Uuid uuid;
    ITrack::Ptr track;
    double duration = 0.0;
};

}
