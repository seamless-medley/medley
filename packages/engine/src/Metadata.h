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
    class Cover
    {
    public:
        Cover()
        {

        }

        Cover(TagLib::ByteVector data, TagLib::String mimeType)
            :
            data(data),
            mimeType(mimeType.toCWString())
        {

        }

        const TagLib::ByteVector& getData() const { return data; }

        const String& getMimeType() const { return mimeType; }

    private:
        TagLib::ByteVector data;
        String mimeType;
    };

    class CoverAndLyrics
    {
    public:
        CoverAndLyrics(const File& file, bool readCover, bool readLyrics);

        const Cover& getCover() const { return cover; }
        const String& getLyrics() const { return lyrics; }
    private:
        void read(const File& file, bool readCover, bool readLyrics);
        void readID3V2(const File& f, bool readCover, bool readLyrics);
        void readXiph(const File& f, bool readCover, bool readLyrics);

        Cover cover;
        String lyrics;
    };

    Metadata();
    void readFromTrack(const ITrack::Ptr track);
    void readFromFile(const File& file);

    FileType getFileType() const { return type; }
    const String& getTitle() const { return title; }
    const String& getArtist() const { return artist; }
    const String& getAlbum() const { return album; }
    float getTrackGain() const { return trackGain; }
    double getCueIn() const { return cueIn; }
    double getCueOut() const { return cueOut; }
    double getLastAudible() const { return lastAudible; }

private:
    bool readID3V2(const File& f);
    bool readXiph(const File& f);
    void readTag(const TagLib::Tag& tag);

    FileType type = FileType::Unknown;
    String title;
    String artist;
    String album;
    float trackGain = 0.0f;
    double cueIn = -1.0;
    double cueOut = -1.0;
    double lastAudible = -1.0;
};

}