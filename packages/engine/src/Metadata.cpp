#include "Metadata.h"
#include <taglib/textidentificationframe.h>
#include <taglib/xiphcomment.h>
#include <taglib/attachedpictureframe.h>

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

void medley::Metadata::readFromTrack(const ITrack::Ptr track)
{
    readFromFile(track->getFile());
}

void medley::Metadata::readFromFile(const File& file)
{
    trackGain = 0.0f;
    title = "";
    artist = "";
    album = "";

    auto filetype = utils::getFileTypeFromFileName(file);

    switch (filetype) {
    case utils::FileType::MP3: {
        readID3V2(file);
        return;
    }

    case utils::FileType::FLAC: {
        readXiph(file);
        return;
    }

    // TODO: Other file types

    }

    title = file.getFileNameWithoutExtension();
}

bool medley::Metadata::readID3V2(const File& f)
{
    #ifdef _WIN32
    TagLib::MPEG::File file((const wchar_t*)f.getFullPathName().toWideCharPointer());
    #else
    TagLib::MPEG::File file(f.getFullPathName().toRawUTF8());
    #endif

    if (!file.hasID3v2Tag()) {
        return false;
    }

    auto& tag = *file.ID3v2Tag();
    readTag(tag);

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

bool medley::Metadata::readXiph(const File& f)
{
    #ifdef _WIN32
    TagLib::FLAC::File file((const wchar_t*)f.getFullPathName().toWideCharPointer());
    #else
    TagLib::FLAC::File file(f.getFullPathName().toRawUTF8());
    #endif

    if (!file.hasXiphComment()) {
        return false;
    }

    auto& tag = *file.xiphComment();
    readTag(tag);

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
            if ((it == frameMap.end()) || it->second.isEmpty()) {
                return;
            }

            const auto frames = it->second;
            for (const auto frame : frames) {
                const auto apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame*>(frame);
                if (apic && apic->type() == TagLib::ID3v2::AttachedPictureFrame::FrontCover) {
                    cover = medley::Metadata::Cover(apic->picture(), apic->mimeType());
                    break;
                }
            }
        }

        if (readLyrics) {
            lyrics = readFirstUserTextIdentificationFrame(tag, L"LYRICS");
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
