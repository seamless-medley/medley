#include "Metadata.h"
#include <taglib/tfilestream.h>
#include <taglib/textidentificationframe.h>
#include <taglib/xiphcomment.h>
#include <taglib/attachedpictureframe.h>
#include <taglib/oggpageheader.h>
#include <taglib/opusfile.h>
#include <taglib/vorbisfile.h>

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

bool readXiphCommentField(const TagLib::Ogg::XiphComment& comment, juce::String key, juce::String* pValue) {
    auto map = comment.fieldListMap();
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
            readMpeg(file);
            return;
        }

        case utils::FileType::FLAC: {
            readFLAC(file);
            return;
        }

        case utils::FileType::OPUS: {
            readOPUS(file);
            return;
        }

        case utils::FileType::OGG: {
            readOggVorbis(file);
            return;
        }

        case utils::FileType::WAV: {
            readWAV(file);
            return;
        }

        case utils::FileType::AIFF: {
            readAIFF(file);
            return;
        }

        default:
            title = file.getFileNameWithoutExtension();
            return;
        }
    }
    catch (std::exception& e) {
        throw std::runtime_error(("Could not read metadata from file " + file.getFullPathName() + " Error was: " + e.what()).toStdString());
    }
    catch (...) {
        throw std::runtime_error(("Could not read metadata from file " + file.getFullPathName()).toStdString());
    }
}

void medley::Metadata::readMpeg(const juce::File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open MPEG file");
    }

    try {
        TagLib::MPEG::File file(&stream, false, TagLib::MPEG::Properties::Fast);

        if (!file.hasID3v2Tag()) {
            return;
        }

        auto& tag = *file.ID3v2Tag();
        readBasicTag(tag);
        readID3Tag(tag);
    }
    catch (...) {
        throw std::runtime_error("reading MPEG");
    }
}

void medley::Metadata::readFLAC(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open FLAC file");
    }

    try {
        TagLib::FLAC::File file(&stream, false, TagLib::FLAC::Properties::Fast);

        if (!file.hasXiphComment()) {
            return;
        }

        auto& tag = *file.xiphComment();
        readBasicTag(tag);
        readXiphTag(tag);
    }
    catch (...) {
        throw std::runtime_error("reading FLAC");
    }
}

void medley::Metadata::readOPUS(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open OPUS file");
    }

    try {
        TagLib::Ogg::Opus::File file(&stream, false, TagLib::Ogg::Opus::Properties::Fast);

        auto& tag = *file.tag();
        readBasicTag(tag);
        readXiphTag(tag, false); // Do not read replaygain

        // Assume OPUS Output gain was revert during the decoding phase.
        auto headerGain = file.packet(0).toShort(16, false);
        if (headerGain != 0) {
            // The output gain is encoded as decibels in Q7.8 notation, hence divide by 256 here
            auto outputGain = headerGain / 256.0f;
            // Since the gain is applied with -23dBFS reference point for opus but we use ReplayGain which has -18dbFS as the reference point
            // So it's 5dB apart
            constexpr float gainCompensation = 5.0f;
            this->trackGain = Decibels::decibelsToGain(outputGain + gainCompensation);
        }
    }
    catch (...) {
        throw std::runtime_error("reading OPUS");
    }
}

void medley::Metadata::readOggVorbis(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open Ogg Vorbis file");
    }

    try {
        TagLib::Ogg::Vorbis::File file(&stream, false, TagLib::Ogg::Vorbis::Properties::Fast);

        auto& tag = *file.tag();
        readBasicTag(tag);
        readXiphTag(tag);
    }
    catch (...) {
        throw std::runtime_error("reading Ogg Vorbis");
    }
}

void medley::Metadata::readWAV(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open WAV file");
    }

    try {
        TagLib::RIFF::WAV::File file(&stream, false, TagLib::RIFF::WAV::Properties::Fast);

        auto& tag = *file.tag();
        readBasicTag(tag);

        if (file.hasID3v2Tag()) {
            readID3Tag(*file.ID3v2Tag());
        }
    }
    catch (...) {
        throw std::runtime_error("reading Wav");
    }
}

void medley::Metadata::readAIFF(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open AIFF file");
    }

    try {
        TagLib::RIFF::AIFF::File file(&stream, false, TagLib::RIFF::AIFF::Properties::Fast);

        auto& tag = *file.tag();
        readBasicTag(tag);

        if (file.hasID3v2Tag()) {
            readID3Tag(tag);
        }
    }
    catch (...) {
        throw std::runtime_error("reading Aiff");
    }
}

void medley::Metadata::readBasicTag(const TagLib::Tag& tag)
{
    title = tag.title().toCWString();
    artist = tag.artist().toCWString();
    album = tag.album().toCWString();
}

void medley::Metadata::readID3Tag(const TagLib::ID3v2::Tag& tag)
{
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

    this->comments.clear();

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

        const auto& textFrames = tag.frameListMap()["TXXX"];
        for (auto& frame : textFrames) {
            if (auto pFrame = dynamic_cast<TagLib::ID3v2::UserTextIdentificationFrame*>(frame)) {
                auto fields = pFrame->fieldList();

                if (fields.size() >= 2) {
                    this->comments.push_back(std::make_pair(fields[0].toCWString(), fields[1].toCWString()));
                }
            }
        }
    }
}

void medley::Metadata::readXiphTag(const TagLib::Ogg::XiphComment& tag, bool readReplayGain)
{
    readXiphCommentField(tag, "ISRC", &isrc);
    readXiphCommentField(tag, "ALBUMARTIST", &albumArtist);
    readXiphCommentField(tag, "ORIGARTIST", &originalArtist);

    if (readReplayGain) {
        juce::String trackGain;
        readXiphCommentField(tag, "REPLAYGAIN_TRACK_GAIN", &trackGain);
        this->trackGain = (float)parseReplayGainGain(trackGain);
    }

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

    this->comments.clear();

    for (auto const& field : tag.fieldListMap()) {
        this->comments.push_back(std::make_pair(
            field.first.toCWString(),
            firstNonEmptyStringListItem(field.second).toCWString()
        ));
    }
}

medley::Metadata::CoverAndLyrics::CoverAndLyrics(const File& file, bool readCover, bool readLyrics)
{
    read(file, readCover, readLyrics);
}

void medley::Metadata::CoverAndLyrics::readMpeg(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open MPEG file");
    }

    try {
        TagLib::MPEG::File file(&stream, false, TagLib::MPEG::Properties::Fast);

        if (file.hasID3v2Tag()) {
            auto& tag = *file.ID3v2Tag();
            readID3Tag(tag, readCover, readLyrics);
        }

    }
    catch (...) {
        throw std::runtime_error("reading MPEG");
    }
}

void medley::Metadata::CoverAndLyrics::readFLAC(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open FLAC file");
    }

    try {
        TagLib::FLAC::File file(&stream, false, TagLib::FLAC::Properties::Fast);

        if (readCover) {
            auto pictures = file.pictureList();

            if (pictures.isEmpty() && file.hasXiphComment()) {
                pictures = file.xiphComment()->pictureList();
            }

            readPictures(pictures);
        }

        if (readLyrics) {
            readXiphLyrics(*file.xiphComment());
        }
    }
    catch (...) {
        throw std::runtime_error("reading FLAC");
    }
}

void medley::Metadata::CoverAndLyrics::readOPUS(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open OPUS file");
    }

    try {

        TagLib::Ogg::Opus::File file(&stream, false, TagLib::Ogg::Opus::Properties::Fast);

        auto tag = file.tag();

        if (readCover) {
            readPictures(tag->pictureList());
        }

        if (readLyrics) {
            readXiphLyrics(*tag);
        }
    }
    catch (...) {
        throw std::runtime_error("reading OPUS");
    }
}

void medley::Metadata::CoverAndLyrics::readOggVorbis(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open Ogg Vorbis file");
    }

    try {
        TagLib::Ogg::Vorbis::File file(&stream, false, TagLib::Ogg::Vorbis::Properties::Fast);

        auto tag = file.tag();

        if (readCover) {
            readPictures(tag->pictureList());
        }

        if (readLyrics) {
            readXiphLyrics(*tag);
        }
    }
    catch (...) {
        throw std::runtime_error("reading Ogg Vorbis");
    }
}

void medley::Metadata::CoverAndLyrics::readWAV(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open WAV file");
    }

    try {
        TagLib::RIFF::WAV::File file(&stream, false, TagLib::RIFF::WAV::Properties::Fast);

        if (file.hasID3v2Tag()) {
            auto& tag = *file.ID3v2Tag();
            readID3Tag(tag, readCover, readLyrics);
        }
    }
    catch (...) {
        throw std::runtime_error("reading WAV");
    }
}

void medley::Metadata::CoverAndLyrics::readAIFF(const File& f, bool readCover, bool readLyrics)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (!stream.isOpen()) {
        throw std::runtime_error("Could not open AIFF file");
    }

    try {
        TagLib::RIFF::AIFF::File file(&stream, false, TagLib::RIFF::AIFF::Properties::Fast);

        if (file.hasID3v2Tag()) {
            readID3Tag(*file.tag(), readCover, readLyrics);
        }
    }
    catch (...) {
        throw std::runtime_error("reading AIFF");
    }
}

void medley::Metadata::CoverAndLyrics::readID3Tag(const TagLib::ID3v2::Tag& tag, bool readCover, bool readLyrics)
{
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

void medley::Metadata::CoverAndLyrics::readPictures(const TagLib::List<TagLib::FLAC::Picture*> pictures)
{
    if (!pictures.isEmpty()) {
        for (const auto picture : pictures) {
            if (picture->type() == TagLib::FLAC::Picture::FrontCover) {
                cover = medley::Metadata::Cover(picture->data(), picture->mimeType());
                break;
            }
        }
    }
}

void medley::Metadata::CoverAndLyrics::readXiphLyrics(const TagLib::Ogg::XiphComment& tag)
{
    if (!readXiphCommentField(tag, "LYRICS", &lyrics)) {
        readXiphCommentField(tag, "UNSYNCED LYRICS", &lyrics);
    }
}

void medley::Metadata::CoverAndLyrics::read(const File& file, bool readCover, bool readLyrics)
{
    auto filetype = utils::getFileTypeFromFileName(file);

    switch (filetype) {
    case utils::FileType::MP3: {
        readMpeg(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::FLAC: {
        readFLAC(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::OPUS: {
        readOPUS(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::OGG: {
        readOggVorbis(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::WAV: {
        readWAV(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::AIFF: {
        readAIFF(file, readCover, readLyrics);
        return;
    }

    case utils::FileType::MP4: {
        // TODO: Implement this
        return;
    }

    default:
        return;
    }
}

medley::Metadata::AudioProperties::AudioProperties(const File& file)
{
    read(file);
}

void medley::Metadata::AudioProperties::read(const File& file)
{
    channels = 0;
    bitrate = 0;
    sampleRate = 0;
    duration = 0;

    auto filetype = utils::getFileTypeFromFileName(file);

    switch (filetype) {
    case utils::FileType::MP3: {
        readMpeg(file);
        return;
    }

    case utils::FileType::FLAC: {
        readFLAC(file);
        return;
    }

    case utils::FileType::OPUS: {
        readOPUS(file);
        return;
    }

    case utils::FileType::OGG: {
        readOggVorbis(file);
        return;
    }

    case utils::FileType::WAV: {
        readWAV(file);
        return;
    }

    case utils::FileType::AIFF: {
        readAIFF(file);
        return;
    }

    case utils::FileType::MP4: {
        // TODO: Implement this
        return;
    }

    default: {

    }
    }
}

void medley::Metadata::AudioProperties::readMpeg(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (stream.isOpen()) {
        try {
            TagLib::MPEG::File file(&stream, true, TagLib::AudioProperties::Fast);
            readAudioProperties(file.audioProperties());
        }
        catch (...) {

        }
    }
}

void medley::Metadata::AudioProperties::readFLAC(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (stream.isOpen()) {
        try {
            TagLib::FLAC::File file(&stream, true, TagLib::AudioProperties::Fast);
            readAudioProperties(file.audioProperties());
        }
        catch (...) {

        }
    }
}

void medley::Metadata::AudioProperties::readOPUS(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (stream.isOpen()) {
        try {
            TagLib::Ogg::Opus::File file(&stream, true, TagLib::AudioProperties::Fast);
            readAudioProperties(file.audioProperties());
        }
        catch (...) {

        }
    }
}

void medley::Metadata::AudioProperties::readOggVorbis(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (stream.isOpen()) {
        try {
            TagLib::Ogg::Vorbis::File file(&stream, true, TagLib::AudioProperties::Fast);
            readAudioProperties(file.audioProperties());
        }
        catch (...) {

        }
    }
}

void medley::Metadata::AudioProperties::readWAV(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (stream.isOpen()) {
        try {
            TagLib::RIFF::WAV::File file(&stream, true, TagLib::AudioProperties::Fast);
            readAudioProperties(file.audioProperties());
        }
        catch (...) {

        }
    }
}

void medley::Metadata::AudioProperties::readAIFF(const File& f)
{
#ifdef _WIN32
    TagLib::FileName fileName((const wchar_t*)f.getFullPathName().toWideCharPointer());
#else
    TagLib::FileName fileName(f.getFullPathName().toRawUTF8());
#endif

    TagLib::FileStream stream(fileName);

    if (stream.isOpen()) {
        try {
            TagLib::RIFF::AIFF::File file(&stream, true, TagLib::AudioProperties::Fast);
            readAudioProperties(file.audioProperties());
        }
        catch (...) {

        }
    }
}

void medley::Metadata::AudioProperties::readAudioProperties(const TagLib::AudioProperties* props)
{
    try {
        channels = props->channels();
        bitrate = props->bitrate();
        sampleRate = props->sampleRate();
        duration = props->lengthInMilliseconds() / 1000.0f;
    }
    catch (...) {
        channels = 0;
        bitrate = 0;
        sampleRate = 0;
        duration = 0;
    }
}
