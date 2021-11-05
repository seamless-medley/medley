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
}