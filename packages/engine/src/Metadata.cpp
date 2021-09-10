#include "Metadata.h"
#include <taglib/textidentificationframe.h>
#include <taglib/xiphcomment.h>

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
    trackGain = 0.0f;
    title = "";
    artist = "";
    album = "";

    auto trackFile = track->getFile();
    auto filetype = utils::getFileTypeFromFileName(trackFile);

    switch (filetype) {
    case utils::FileType::MP3: {
        readID3V2(track);
        return;
    }

    case utils::FileType::FLAC: {
        readXiph(track);
        return;
    }

    // TODO: Other file types

    }

    title = track->getFile().getFileNameWithoutExtension();
}

bool medley::Metadata::readID3V2(const ITrack::Ptr track)
{
    TagLib::MPEG::File file((const wchar_t*)track->getFile().getFullPathName().toWideCharPointer());

    if (!file.hasID3v2Tag()) {
        return false;
    }

    auto& tag = *file.ID3v2Tag();
    readTag(tag);

    if (tag.header()->majorVersion() >= 3) {
        auto trackGain = readFirstUserTextIdentificationFrame(tag, L"REPLAYGAIN_TRACK_GAIN");
        this->trackGain = (float)parseReplayGainGain(trackGain);
    }

    return true;
}

bool medley::Metadata::readXiph(const ITrack::Ptr track)
{
    TagLib::FLAC::File file((const wchar_t*)track->getFile().getFullPathName().getCharPointer());

    if (!file.hasXiphComment()) {
        return false;
    }

    auto& tag = *file.xiphComment();
    readTag(tag);

    juce::String trackGain;
    readXiphCommentField(tag, "REPLAYGAIN_TRACK_GAIN", &trackGain);
    this->trackGain = (float)parseReplayGainGain(trackGain);
}

void medley::Metadata::readTag(const TagLib::Tag& tag)
{
    title = tag.title().toCWString();
    artist = tag.artist().toCWString();
    album = tag.album().toCWString();
}
