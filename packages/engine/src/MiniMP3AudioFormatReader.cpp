#include "MiniMP3AudioFormatReader.h"

#define MINIMP3_IMPLEMENTATION
#define MINIMP3_FLOAT_OUTPUT

#include <minimp3.h>
#include <minimp3_ex.h>

#include <inttypes.h>

MiniMP3AudioFormatReader::MiniMP3AudioFormatReader(InputStream* const in)
    : AudioFormatReader(in, "MP3 Format")
{
    io.read = &ioRead;
    io.read_data = this;
    io.seek = &ioSeek;
    io.seek_data = this;

    auto ret = mp3dec_ex_open_cb(&dec, &io, MP3D_SEEK_TO_SAMPLE);

    if (ret != 0) {
        return;
    }

    opened = true;
    bitsPerSample = 32;
    usesFloatingPointData = true;
    sampleRate = dec.info.hz;
    numChannels = dec.info.channels;
    currentPosition = 0;
    lengthInSamples = dec.detected_samples / numChannels;

    if (lengthInSamples <= 0) {
        lengthInSamples = dec.samples / numChannels;
    }

    reallocBuffer();
}

bool MiniMP3AudioFormatReader::readSamples(int** destSamples, int numDestChannels, int startOffsetInDestBuffer, int64 startFrameInFile, int numFrames)
{
    if (!opened) {
        return false;
    }

    if (numFrames > frameBufferSize) {
        frameBufferSize = numFrames;
        reallocBuffer();
    }


    if (currentPosition != startFrameInFile) {
        if (mp3dec_ex_seek(&dec, startFrameInFile * numChannels) == 0) {
            currentPosition = dec.cur_sample / numChannels;
        }
    }

    auto framesRead = mp3dec_ex_read(&dec, buffer, numFrames * numChannels) / numChannels;

    auto dst = (float**)destSamples;

    if (framesRead > 0) {
        AudioDataConverters::deinterleaveSamples(buffer, dst, framesRead, numChannels);
    }

    if (framesRead < (unsigned int)numFrames) {
        for (int i = numDestChannels; --i >= 0;) {
            if (dst[i] != nullptr) {
                zeromem(dst[i] + startOffsetInDestBuffer + framesRead, ((size_t)numFrames - framesRead) * sizeof(float));
            }
        }
    }

    currentPosition += numFrames;

    return true;
}

void MiniMP3AudioFormatReader::reallocBuffer()
{
    buffer.realloc(frameBufferSize * numChannels, sizeof(float));
}

size_t MiniMP3AudioFormatReader::ioRead(void* buf, size_t size, void* user_data)
{
    auto inst = (MiniMP3AudioFormatReader*)user_data;

    if (!inst) {
        return -1;
    }

    return inst->input->read(buf, size);
}

int MiniMP3AudioFormatReader::ioSeek(uint64_t position, void* user_data)
{
    auto inst = (MiniMP3AudioFormatReader*)user_data;

    if (!inst) {
        return -1;
    }

    return inst->input->setPosition(position) ? 0 : -1;
}
