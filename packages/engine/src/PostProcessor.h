#pragma once

#include <JuceHeader.h>

#include "LookAheadLimiter.h"

using namespace juce::dsp;

class PostProcessor {
public:
    PostProcessor() {
        
    }

    inline void prepare(const ProcessSpec& spec) {
         chain.prepare(spec);        
    }

    inline void process(const ProcessContextReplacing<float>& context) {
         chain.process(context);
    }

    inline void reset() {
         chain.reset();
    }

private:
     ProcessorChain<LookAheadLimiter> chain;
};
