#pragma once

#include <JuceHeader.h>

using namespace juce;

namespace medley {
class ITrack : public ReferenceCountedObject {
public:
    virtual File getFile() = 0;

    virtual double getCueInPosition() { return -1.0; }

    virtual double getCueOutPosition() { return -1.0; }

    using Ptr = ReferenceCountedObjectPtr<ITrack>;
};

class TrackPlay {
public:
    TrackPlay()
    {

    }

    TrackPlay(ITrack::Ptr track)
        : track(track)
    {

    }

    TrackPlay(const TrackPlay& other)
        : uuid(other.uuid), track(other.track)
    {

    }

    const Uuid& getUuid() const { return uuid; }
    ITrack::Ptr getTrack() const { return track; }
private:
    Uuid uuid;
    ITrack::Ptr track;
};

}