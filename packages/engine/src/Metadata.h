#pragma once

#include <JuceHeader.h>
#include <taglib/tag.h>
#include <taglib/aifffile.h>
#include <taglib/flacfile.h>
#include <taglib/mp4file.h>
#include <taglib/mpegfile.h>
#include <taglib/wavfile.h>
#include <taglib/fileref.h>
#include <map>
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

        const juce::String& getMimeType() const { return mimeType; }

    private:
        TagLib::ByteVector data;
        juce::String mimeType;
    };

    class CoverAndLyrics
    {
    public:
        CoverAndLyrics(const File& file, bool readCover, bool readLyrics);

        const Cover& getCover() const { return cover; }
        const juce::String& getLyrics() const { return lyrics; }
    private:
        void read(const File& file, bool readCover, bool readLyrics);
        void readMpeg(const File& f, bool readCover, bool readLyrics);
        void readFLAC(const File& f, bool readCover, bool readLyrics);
        void readOPUS(const File& f, bool readCover, bool readLyrics);
        void readOggVorbis(const File& f, bool readCover, bool readLyrics);
        void readWAV(const File& f, bool readCover, bool readLyrics);
        void readAIFF(const File& f, bool readCover, bool readLyrics);
        //
        void readID3Tag(const TagLib::ID3v2::Tag& tag, bool readCover, bool readLyrics);
        void readPictures(const TagLib::List<TagLib::FLAC::Picture*> pictures);
        void readXiphLyrics(const TagLib::Ogg::XiphComment& tag);

        Cover cover;
        juce::String lyrics;
    };

    class AudioProperties
    {
    public:
        AudioProperties(const File& file, TagLib::AudioProperties::ReadStyle readStyle = TagLib::AudioProperties::ReadStyle::Fast);

        int getChannels() const { return channels; }
        int getBitrate() const { return bitrate; }
        int getSampleRate() const { return sampleRate; }
        double getDuration() const { return duration; }

    private:
        void read(const File& file, TagLib::AudioProperties::ReadStyle readStyle);
        void readMpeg(const File& f, TagLib::AudioProperties::ReadStyle readStyle);
        void readFLAC(const File& f, TagLib::AudioProperties::ReadStyle readStyle);
        void readOPUS(const File& f, TagLib::AudioProperties::ReadStyle readStyle);
        void readOggVorbis(const File& f, TagLib::AudioProperties::ReadStyle readStyle);
        void readWAV(const File& f, TagLib::AudioProperties::ReadStyle readStyle);
        void readAIFF(const File& f, TagLib::AudioProperties::ReadStyle readStyle);
        //
        void readAudioProperties(const TagLib::AudioProperties* props);

        int channels = 0;
        int bitrate = 0;
        int sampleRate = 0;
        double duration = 0;
    };

    Metadata();

    void readFromTrack(const ITrack::Ptr track);
    void readFromFile(const File& file);

    FileType getFileType() const { return type; }
    const juce::String& getTitle() const { return title; }
    const juce::String& getArtist() const { return artist; }
    const juce::String& getAlbum() const { return album; }
    const juce::String& getISRC() const { return isrc; }
    const juce::String& getAlbumArtist() const { return albumArtist; }
    const juce::String& getOriginalArtist() const { return originalArtist; }

    float getTrackGain() const { return trackGain; }
    float getBeatsPerMinute() const { return bpm; }
    double getCueIn() const { return cueIn; }
    double getCueOut() const { return cueOut; }
    double getLastAudible() const { return lastAudible; }

    std::vector<std::pair<juce::String, juce::String>>&  getComments() { return comments; }

private:
    void readMpeg(const File& f);
    void readFLAC(const File& f);
    void readOPUS(const File& f);
    void readOggVorbis(const File& f);
    void readWAV(const File& f);
    void readAIFF(const File& f);
    //
    void readBasicTag(const TagLib::Tag& tag);
    void readID3Tag(const TagLib::ID3v2::Tag& tag);
    void readXiphTag(const TagLib::Ogg::XiphComment& tag, bool readReplayGain = true);

    FileType type = FileType::Unknown;
    juce::String title;
    juce::String artist;
    juce::String album;
    juce::String isrc;
    juce::String albumArtist;
    juce::String originalArtist;
    float bpm = 0.0f;
    float trackGain = 0.0f;
    double cueIn = -1.0;
    double cueOut = -1.0;
    double lastAudible = -1.0;

    std::vector<std::pair<juce::String, juce::String>> comments;
};


}
