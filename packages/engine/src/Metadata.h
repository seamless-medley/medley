#pragma once

#include <JuceHeader.h>
#include <taglib/tag.h>
#include <taglib/aifffile.h>
#include <taglib/flacfile.h>
#include <taglib/mp4file.h>
#include <taglib/mpegfile.h>
#include <taglib/wavfile.h>
#include <taglib/fileref.h>
#include "ITrack.h"
#include "utils.h"

namespace medley {

class ReplayGain {

};

using namespace juce;
using namespace utils;

class Metadata {
public:
    Metadata();
    void readFromTrack(const ITrack::Ptr track);

    const FileType getFileType() const { return type; }
    const String& getTitle() const { return title; }
    const String& getArtist() const { return artist; }
    const String& getAlbum() const { return album; }
    float getTrackGain() const { return trackGain; }

private:
    bool readID3V2(const ITrack::Ptr track);
    bool readXiph(const ITrack::Ptr track);
    void readTag(const TagLib::Tag& tag);

    FileType type = FileType::Unknown;
    String title;
    String artist;
    String album;
    float trackGain = 0.0f;
};

}