#pragma once

#include <JuceHeader.h>

using namespace juce;

namespace medley {
class ITrack : public ReferenceCountedObject {
public:
    virtual File& getFile() = 0;
    // TODO: ReplayGain

    using Ptr = ReferenceCountedObjectPtr<ITrack>;
};
}