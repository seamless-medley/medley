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
        formatSource = new AudioFormatReaderSource(reader, false);

        auto sampleRate = formatSource->getAudioFormatReader()->sampleRate;
        setSource(formatSource, sampleRate * 0.25, &readAheadThread, sampleRate);
        setPositionFractional(0.85);
    }
    else {
        setSource(nullptr);
    }
}

void TrackBuffer::unloadTrack()
{
    listeners.call([](Callback& cb) {
        cb.unloaded();
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
    auto hadFinished = hasStreamFinished();

    AudioTransportSource::getNextAudioBlock(info);

    if (hadFinished && !hasStreamFinished()) {
        listeners.call([](Callback& cb) {
            cb.finished();
        });

        unloadTrack();
    }
}
