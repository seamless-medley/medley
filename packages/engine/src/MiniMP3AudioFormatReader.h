#pragma once

#define MINIMP3_FLOAT_OUTPUT

#include <JuceHeader.h>
#include <minimp3_ex.h>

using namespace juce;

class MiniMP3AudioFormatReader : public AudioFormatReader
{
public:
    MiniMP3AudioFormatReader(InputStream* const in);

    bool readSamples(int** destSamples, int numDestChannels, int startOffsetInDestBuffer, int64 startSampleInFile, int numSamples) override;

private:
    void reallocBuffer();

    static size_t ioRead(void* buf, size_t size, void* user_data);
    static int ioSeek(uint64_t position, void* user_data);

    mp3dec_ex_t dec{};
    mp3dec_io_t io{};

    HeapBlock<float> buffer;
    int frameBufferSize = 4096;

    int64 currentPosition = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MiniMP3AudioFormatReader)
};

