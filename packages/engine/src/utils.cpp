#include "utils.h"

namespace medley {
namespace utils {

AudioFormatReader* createAudioReaderFor(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track) {
    try {
        auto file = track->getFile();

        if (!file.existsAsFile()) {
            return nullptr;
        }

        return formatMgr.createReaderFor(file);
    }
    catch (...) {
        return nullptr;
    }
}

bool isTrackLoadable(juce::AudioFormatManager& formatMgr, const ITrack::Ptr track) {
    auto reader = createAudioReaderFor(formatMgr, track);
    if (reader == nullptr) {
        return false;
    }

    delete reader;
    return true;
}

FileType getFileTypeFromFileName(juce::String& filename) {
    return getFileTypeFromFileName(juce::File(filename));
}

FileType getFileTypeFromFileName(juce::File file) {
    auto ext = file.getFileExtension();

    if (ext.equalsIgnoreCase(".mp3")) {
        return FileType::MP3;
    }

    if (ext.equalsIgnoreCase(".m4a")) {
        return FileType::MP4; // OSX Only
    }

    if (ext.equalsIgnoreCase(".flac")) {
        return FileType::FLAC;
    }

    if (ext.equalsIgnoreCase(".ogg")) {
        return FileType::OGG;
    }

    if (ext.equalsIgnoreCase(".wav")) {
        return FileType::WAV;
    }

    if (ext.equalsIgnoreCase(".aif") || ext.equalsIgnoreCase(".aiff")) {
        return FileType::AIFF;
    }

    return FileType::Unknown;
}

}
}
