#pragma once

#include <JuceHeader.h>

using namespace juce;

namespace medley {
class ITrack : public ReferenceCountedObject {
public:
    virtual File getFile() = 0;
    virtual float getPreGain() const { return 1.0f; }

    using Ptr = ReferenceCountedObjectPtr<ITrack>;
};
}