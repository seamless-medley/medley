#include "Metadata.h"
#include <taglib/tfilestream.h>
#include <taglib/textidentificationframe.h>
#include <taglib/xiphcomment.h>
#include <taglib/attachedpictureframe.h>

#include "MiniMP3AudioFormatReader.h"

namespace {

TagLib::ID3v2::UserTextIdentificationFrame* findFirstUserTextIdentificationFrame(const TagLib::ID3v2::Tag& tag, juce::String& description) {
    TagLib::ID3v2::UserTextIdentificationFrame* pFirstFrame = nullptr;

    const auto& textFrames = tag.frameListMap()["TXXX"];
    for (auto& frame : textFrames) {
        if (auto pFrame = dynamic_cast<TagLib::ID3v2::UserTextIdentificationFrame*>(frame)) {
            juce::String desc(pFrame->description().toCWString());
            if (desc.equalsIgnoreCase(description)) {
                if (!pFrame->toString().isEmpty()) {
                    return pFrame;
                }

                if (!pFirstFrame) {
                    pFirstFrame = pFrame;
                }
            }
        }
    }

    return pFirstFrame;
}

juce::String readFirstUserTextIdentificationFrame(const TagLib::ID3v2::Tag& tag, juce::String description) {
    auto frame = findFirstUserTextIdentificationFrame(tag, description);
    return (frame && (frame->fieldList().size() > 1)) ? frame->fieldList()[1].toCWString() : L"";
}

juce::String normalizeNumberString(const juce::String& number) {
    return number.trim().trimCharactersAtStart("+");
}

TagLib::String firstNonEmptyStringListItem(const TagLib::StringList& strList) {
    for (const auto& str : strList) {
        if (!str.isEmpty()) {
            return str;
        }
    }

    return TagLib::String();
}

double parseReplayGainGain(const juce::String& dbGain) {
    auto gain = normalizeNumberString(dbGain);

    auto unitIndex = gain.lastIndexOfIgnoreCase("dB");
    if (unitIndex >= 0 && unitIndex == gain.length() - 2) {
        gain = gain.substring(0, unitIndex).trim();
    }

    if (gain.isEmpty()) {
        return 0.0;
    }

    auto decibel = gain.getDoubleValue();
    auto ratio = Decibels::decibelsToGain(decibel);
    return ratio > 0.0 ? ratio : 0.0;
}

bool readXiphCommentField(const TagLib::Ogg::XiphComment& tag, juce::String key, juce::String* pValue) {
    auto map = tag.fieldListMap();
    auto it = map.find(key.toWideCharPointer());

    if (it == map.end()) {
        return false;
    }

    if (pValue) {
        *pValue = juce::String(firstNonEmptyStringListItem(it->second).toCWString());
    }

    return true;
}

}


medley::Metadata::Metadata()
{

}

bool medley::Metadata::readFromTrack(const ITrack::Ptr track)
{
    return readFromFile(track->getFile());
}

bool medley::Metadata::readFromFile(const File& file)
{
    bpm = 0.0f;
    trackGain = 0.0f;
    cueIn = -1.0;
    cueOut = -1.0;
    lastAudible = -1.0;
    title = "";
    artist = "";
    album = "";
    isrc = "";
    albumArtist = "";
    originalArtist = "";

    try {
        auto filetype = utils::getFileTypeFromFileName(file);

        switch (filetype) {
        case utils::FileType::MP3: {
            return readID3V2(file);
        }

        case utils::FileType::FLAC: {
            return readFLAC(file);
        }

                                  // TODO: Other file types

        }

        title = file.getFileNameWithoutExtension();
        return true;
    }
    catch (std::exception& e) {
        throw std::runtime_error(("Could not read metadata from file " + file.getFullPathName() + " Error was: " + e.what()).toStdString());
    }
    catch (...) {
        throw std::runtime_error(("Could not read metadata from file " + file.getFullPathName()).toStdString());
    }

    return false;
}

namespace {
    static size_t minimp3_read_cb(void* buf, size_t size, void* user_data)
    {
        auto input = (FileInputStream*)user_data;

        if (!input) {
            return -1;
        }

        return input->read(buf, size);
    }

    static int minimp3_seek_cb(uint64_t position, void* user_data)
    {
        auto input = (FileInputStream*)user_data;

        if (!input) {
            return -1;
        }

        return input->setPosition(position) ? 0 : -1;
    }
}

void medley::Metadata::readMpegInfo(const File& f)
{
    FileInputStream stream(f);

    mp3dec_io_t io{};
    mp3dec_ex_t dec{};

    io.read = &minimp3_read_cb;
    io.seek = &minimp3_seek_cb;
    io.read_data = io.seek_data = &stream;

    mp3dec_ex_open_cb(&dec, &io, MP3D_SEEK_TO_SAMPLE);

    auto lengthInSamples = dec.detected_samples / dec.info.channels;

    if (lengthInSamples <= 0) {
        lengthInSamples = dec.samples / dec.info.channels;
    }

    bitrate = dec.info.bitrate_kbps;
    sampleRate = dec.info.hz;
    duration = lengthInSamples / (float)sampleRate;
}

bool medley::Metadata::readID3V2(const juce::File& f)
{
    #ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
    #else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
    #endif    

    TagLib::MPEG::File file(fileName, TagLib::ID3v2::FrameFactory::instance());

    if (!file.isValid()) {
        throw std::runtime_error("Could not open MPEG file for reading");
    }

    try {

        readMpegInfo(f);

        if (!file.hasID3v2Tag()) {
            return false;
        }

        auto& tag = *file.ID3v2Tag();
        readTag(tag);

        const auto& tpe2Frames = tag.frameListMap()["TPE2"];
        if (!tpe2Frames.isEmpty()) {
            for (const auto pFrame : tpe2Frames) {
                if (pFrame) {
                    albumArtist = pFrame->toString().toCWString();
                    break;
                }
            }
        }

        const auto& topeFrames = tag.frameListMap()["TOPE"];
        if (!topeFrames.isEmpty()) {
            for (const auto pFrame : topeFrames) {
                if (pFrame) {
                    originalArtist = pFrame->toString().toCWString();
                    break;
                }
            }
        }

        const auto& tsrcFrames = tag.frameListMap()["TSRC"];
        if (!tsrcFrames.isEmpty()) {
            for (const auto pFrame : tsrcFrames) {
                if (pFrame) {
                    isrc = pFrame->toString().toCWString();
                    break;
                }
            }
        }

        const auto& tbpmFrames = tag.frameListMap()["TBPM"];
        if (!tbpmFrames.isEmpty()) {
            for (const auto pFrame : tbpmFrames) {
                if (pFrame) {
                    juce::String bpm = pFrame->toString().toCWString();
                    this->bpm = bpm.getFloatValue();

                    if (this->bpm < 0.0f) {
                        this->bpm = 0.0f;

                    }
                    break;
                }
            }
        }

        if (tag.header()->majorVersion() >= 3) {
            auto trackGain = readFirstUserTextIdentificationFrame(tag, L"REPLAYGAIN_TRACK_GAIN");
            this->trackGain = (float)parseReplayGainGain(trackGain);

            auto cueIn = readFirstUserTextIdentificationFrame(tag, L"CUE-IN");
            if (cueIn.isEmpty()) {
                cueIn = readFirstUserTextIdentificationFrame(tag, L"CUE_IN");
            }

            this->cueIn = cueIn.isNotEmpty() ? cueIn.getDoubleValue() : -1.0;

            auto cueOut = readFirstUserTextIdentificationFrame(tag, L"CUE-OUT");
            if (cueOut.isEmpty()) {
                cueOut = readFirstUserTextIdentificationFrame(tag, L"CUE_OUT");
            }

            this->cueOut = cueOut.isNotEmpty() ? cueOut.getDoubleValue() : -1.0;

            auto lastAudible = readFirstUserTextIdentificationFrame(tag, L"LAST_AUDIBLE");

            this->lastAudible = lastAudible.isNotEmpty() ? lastAudible.getDoubleValue() : -1.0;
        }

        return true;
    }
    catch (...) {
        throw std::runtime_error("reading ID3V2");
    }
}

bool medley::Metadata::readFLAC(const File& f)
{
    #ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
    #else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
    #endif

    TagLib::FileStream stream(fileName);
    TagLib::FLAC::File file(&stream, TagLib::ID3v2::FrameFactory::instance(), true, TagLib::AudioProperties::Fast);

    if (!file.isValid()) {
        throw std::runtime_error("Invalid FLAC file");
    }

    if (TagLib::FLAC::File::isSupported(&stream)) {
        try {
            auto const props = file.audioProperties();

            bitrate = props->bitrate();
            sampleRate = props->sampleRate();
            duration = props->lengthInMilliseconds() / 1000.0;
        }
        catch (...) {
            bitrate = 0;
            sampleRate = 0;
            duration = 0;
        }
    }

    try {

        if (!file.hasXiphComment()) {
            return false;
        }

        auto& tag = *file.xiphComment();
        readTag(tag);

        juce::String isrc;
        readXiphCommentField(tag, "ISRC", &isrc);
        this->isrc = isrc;

        juce::String albumArtist;
        readXiphCommentField(tag, "ALBUMARTIST", &albumArtist);
        this->albumArtist = albumArtist;

        juce::String originalArtist;
        readXiphCommentField(tag, "ORIGARTIST", &isrc);
        this->originalArtist = originalArtist;


        juce::String trackGain;
        readXiphCommentField(tag, "REPLAYGAIN_TRACK_GAIN", &trackGain);
        this->trackGain = (float)parseReplayGainGain(trackGain);

        juce::String cueIn;
        readXiphCommentField(tag, L"CUE-IN", &cueIn);
        if (cueIn.isEmpty()) {
            readXiphCommentField(tag, L"CUE_IN", &cueIn);
        }

        this->cueIn = cueIn.isNotEmpty() ? cueIn.getDoubleValue() : -1.0;

        juce::String cueOut;
        readXiphCommentField(tag, L"CUE-OUT", &cueOut);
        if (cueOut.isEmpty()) {
            readXiphCommentField(tag, L"CUE_OUT", &cueOut);
        }

        this->cueOut = cueOut.isNotEmpty() ? cueOut.getDoubleValue() : -1.0;

        juce::String lastAudible;
        readXiphCommentField(tag, L"LAST_AUDIBLE", &lastAudible);

        this->lastAudible = lastAudible.isNotEmpty() ? lastAudible.getDoubleValue() : -1.0;

        return true;
    }
    catch (...) {
        throw std::runtime_error("reading FLAC");
    }
}

void medley::Metadata::readTag(const TagLib::Tag& tag)
{
    title = tag.title().toCWString();
    artist = tag.artist().toCWString();
    album = tag.album().toCWString();
}

medley::Metadata::CoverAndLyrics::CoverAndLyrics(const File& file, bool readCover, bool readLyrics)
{
    read(file, readCover, readLyrics);
}

void medley::Metadata::CoverAndLyrics::readID3V2(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::MPEG::File file((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::MPEG::File file(f.getFullPathName().toRawUTF8());
#endif

    if (file.hasID3v2Tag()) {
        auto& tag = *file.ID3v2Tag();

        if (readCover) {
            auto frameMap = tag.frameListMap();
            const auto it = frameMap.find("APIC");

            if ((it != frameMap.end()) && !it->second.isEmpty()) {
                const auto frames = it->second;

                for (const auto frame : frames) {
                    const auto apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame*>(frame);
                    if (apic && apic->type() == TagLib::ID3v2::AttachedPictureFrame::FrontCover) {
                        cover = medley::Metadata::Cover(apic->picture(), apic->mimeType());
                        break;
                    }
                }

                if (cover.getData().isEmpty() && frames.size()) {
                    if (const auto apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame*>(frames[0])) {
                        cover = medley::Metadata::Cover(apic->picture(), apic->mimeType());
                    }
                }
            }
        }

        if (readLyrics) {
            lyrics = readFirstUserTextIdentificationFrame(tag, L"LYRICS");

            // TODO: UNSYNCED LYRICS

            if (lyrics.isEmpty()) {
                const auto& usltFrames = tag.frameListMap()["USLT"];
                if (!usltFrames.isEmpty()) {
                    for (const auto pFrame : usltFrames) {
                        if (pFrame) {
                            lyrics = pFrame->toString().toCWString();
                            break;
                        }
                    }
                }
            }
        }
    }
}

void medley::Metadata::CoverAndLyrics::readXiph(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FLAC::File file((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FLAC::File file(f.getFullPathName().toRawUTF8());
#endif

    if (readCover) {
        auto pictures = file.pictureList();

        if (pictures.isEmpty() && file.hasXiphComment()) {
            pictures = file.xiphComment()->pictureList();
        }

        if (!pictures.isEmpty()) {
            for (const auto picture : pictures) {
                if (picture->type() == TagLib::FLAC::Picture::FrontCover) {
                    cover = medley::Metadata::Cover(picture->data(), picture->mimeType());
                    break;
                }
            }
        }
    }

    if (readLyrics) {
        auto tag = file.xiphComment();
        readXiphCommentField(*tag, "LYRICS", &lyrics);
    }
}

void medley::Metadata::CoverAndLyrics::read(const File& file, bool readCover, bool readLyrics)
{
    auto filetype = utils::getFileTypeFromFileName(file);

    switch (filetype) {
    case utils::FileType::MP3: {
        readID3V2(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::FLAC: {
        readXiph(file, readCover, readLyrics);
        return;
    }
    }
}
