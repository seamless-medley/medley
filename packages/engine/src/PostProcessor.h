#pragma once

#include <JuceHeader.h>

using namespace juce::dsp;

class PostProcessor {
public:
    PostProcessor() {
        // chain.get<0>().setThreshold(0);
    }

    inline void prepare(const ProcessSpec& spec) {
        // chain.prepare(spec);        
    }

    inline void process(const ProcessContextReplacing<float>& context) {
        // chain.process(context);
    }

    inline void reset() {
        // chain.reset();
    }

private:
    // ProcessorChain<Limiter<float>> chain;
};
