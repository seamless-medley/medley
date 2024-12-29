#include "OpusAudioFormat.h"
#include "OpusAudioFormatReader.h"

juce::AudioFormatReader* OpusAudioFormat::createReaderFor(juce::InputStream* sourceStream, bool deleteStreamIfOpeningFails)
{
    std::unique_ptr<OpusAudioFormatReader> r(new OpusAudioFormatReader(sourceStream));

    if (r->isOpened())
        return r.release();

    if (!deleteStreamIfOpeningFails)
        r->input = nullptr;

    return nullptr;
}
