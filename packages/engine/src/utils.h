#pragma once

#include <JuceHeader.h>
#include "ITrack.h"

namespace medley {
namespace utils {

enum class FileType {
    Unknown = -1,
    MP3,
    MP4,
    FLAC,
    OGG,
    WAV,
    AIFF,
    OPUS
};

AudioFormatReader* createAudioReaderFor(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track);
bool isTrackLoadable(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track);
FileType getFileTypeFromFileName(juce::String& filename);
FileType getFileTypeFromFileName(juce::File file);

}
}
