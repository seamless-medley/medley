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

    mp3dec_ex_open_cb(&dec, &io, MP3D_SEEK_TO_SAMPLE);

    bitsPerSample = 32;
    usesFloatingPointData = true;
    sampleRate = dec.info.hz;
    numChannels = dec.info.channels;
    currentPosition = dec.start_delay / numChannels;
    lengthInSamples = dec.detected_samples / numChannels;

    if (lengthInSamples <= 0) {
        lengthInSamples = dec.samples / numChannels;
    }

    reallocBuffer();
}

bool MiniMP3AudioFormatReader::readSamples(int** destSamples, int numDestChannels, int startOffsetInDestBuffer, int64 startFrameInFile, int numFrames)
{
    if (numFrames > frameBufferSize) {
        frameBufferSize = numFrames;
        reallocBuffer();
    }

    auto ssif = startFrameInFile + dec.start_delay / numChannels;

    if (currentPosition != ssif) {
        if (mp3dec_ex_seek(&dec, (ssif - 1) * numChannels) != 0) {
            currentPosition = -1;
            jassertfalse;
        }
        else {
            currentPosition = ssif;
        }
    }    

    mp3d_sample_t** const dst = reinterpret_cast<mp3d_sample_t**> (destSamples);

    auto read = mp3dec_ex_read(&dec, buffer, numFrames * numChannels);
    currentPosition += read / numChannels;

    AudioDataConverters::deinterleaveSamples(buffer, (float**)destSamples, read / numChannels, numChannels);

    return read != 0;
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
