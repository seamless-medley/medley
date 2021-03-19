#pragma once

#include <JuceHeader.h>
#include "ITrack.h"

namespace medley {
namespace utils {

AudioFormatReader* createAudioReaderFor(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track);
bool isTrackLoadable(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track);

}
}