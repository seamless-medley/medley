#pragma once

#include <JuceHeader.h>
#include "opus/opusfile.h"

class OpusAudioFormatReader : public juce::AudioFormatReader
{
public:
    OpusAudioFormatReader(juce::InputStream* const in);

    bool readSamples(int** destSamples, int numDestChannels, int startOffsetInDestBuffer, juce::int64 startSampleInFile, int numFrames) override;

    inline bool isOpened() const { return opened; }

private:
    void reallocBuffer();

    static int ioRead(void* _stream, unsigned char* _ptr, int _nbytes);
    static int ioSeek(void* _stream, opus_int64 _offset, int _whence);
    static opus_int64 ioTell(void* _stream);

    OggOpusFile* of = nullptr;
    OpusFileCallbacks cb{};

    bool opened = false;

    juce::HeapBlock<float> buffer;
    juce::AudioBuffer<float> nonInterleavedBuffer;
    int frameBufferSize = 5760;

    juce::AudioBuffer<float> reservoir;
    juce::Range<juce::int64> bufferedRange;
};
