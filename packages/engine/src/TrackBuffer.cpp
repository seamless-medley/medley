#include "TrackBuffer.h"

TrackBuffer::TrackBuffer(AudioFormatManager& formatMgr, TimeSliceThread& readAheadThread)
    :
    AudioTransportSource(),
    formatMgr(formatMgr),
    readAheadThread(readAheadThread)
{

}

TrackBuffer::~TrackBuffer() {
    unloadTrack();
}

void TrackBuffer::loadTrack(const File& file)
{
    reader = formatMgr.createReaderFor(file);

    if (reader) {
        DBG("[loadTrack] Creating Reader");
        formatSource = new AudioFormatReaderSource(reader, false);

        auto sampleRate = formatSource->getAudioFormatReader()->sampleRate;
        setSource(formatSource, sampleRate * 2, &readAheadThread, sampleRate);
    }
    else {
        setSource(nullptr);
    }

    DBG("[loadTrack] Done");
}

void TrackBuffer::unloadTrack()
{
    if (!reader) {
        return;
    }

    listeners.call([this](Callback& cb) {
        cb.unloaded(*this);
     });

    setSource(nullptr);

    if (formatSource) {
        delete formatSource;
        formatSource = nullptr;
    }

    if (reader) {
        delete reader;
        reader = nullptr;
    }
}

void TrackBuffer::setPositionFractional(double fraction) {
    setPosition(getLengthInSeconds() * fraction);
}

void TrackBuffer::getNextAudioBlock(const AudioSourceChannelInfo& info)
{
    auto wasPlaying = isPlaying();

    AudioTransportSource::getNextAudioBlock(info);

    if (wasPlaying && !isPlaying()) {
        listeners.call([this](Callback& cb) {
            cb.finished(*this);
        });

        unloadTrack();
    }
}
