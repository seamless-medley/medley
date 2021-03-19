#include "utils.h"

namespace medley {
namespace utils {

AudioFormatReader* createAudioReaderFor(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track) {
    auto file = track->getFile();

    if (!file.existsAsFile()) {
        return nullptr;
    }

    return formatMgr.createReaderFor(file);
}

bool isTrackLoadable(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track) {
    auto reader = createAudioReaderFor(formatMgr, track);
    if (reader == nullptr) {
        return false;
    }

    delete reader;
    return true;
}

}
}