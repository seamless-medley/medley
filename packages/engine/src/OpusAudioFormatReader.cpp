#include "OpusAudioFormatReader.h"


OpusAudioFormatReader::OpusAudioFormatReader(juce::InputStream* const in)
    : AudioFormatReader(in, "Opus")
{
    cb.read = ioRead;
    cb.seek = ioSeek;
    cb.tell = ioTell;

    lengthInSamples = 0;

    int error = 0;
    of = op_open_callbacks(this, &cb, nullptr, 0, &error);

    if (error != 0) {
        return;
    }

    // Revert gain applied to the decoded samples, we will handle this ourself in the audio pipeline
    auto hdr = op_head(of, -1);
    op_set_gain_offset(of, OP_HEADER_GAIN, -hdr->output_gain);

    bitsPerSample = 32; 
    usesFloatingPointData = true;
    sampleRate = 48000;
    numChannels = 2;
    lengthInSamples = op_pcm_total(of, -1);

    opened = true;
    reallocBuffer();

    reservoir.setSize((int)numChannels, 2 * frameBufferSize, false, false, true);
}

bool OpusAudioFormatReader::readSamples(int** destSamples, int numDestChannels, int startOffsetInDestBuffer, juce::int64 startFrameInFile, int numFrames)
{
    if (!opened) {
        return false;
    }

    juce::Range<juce::int64> rangeToLoad{ startFrameInFile, startFrameInFile + numFrames };

    const auto getBufferedRange = [this] { return bufferedRange; };

    const auto readFromReservoir = [this, &destSamples, &numDestChannels, &startOffsetInDestBuffer, &startFrameInFile](const juce::Range<juce::int64> rangeToRead)
    {
        const auto bufferIndices = rangeToRead - bufferedRange.getStart();
        const auto writePos = (juce::int64)startOffsetInDestBuffer + (rangeToRead.getStart() - startFrameInFile);

        for (int i = juce::jmin(numDestChannels, reservoir.getNumChannels()); --i >= 0;)
        {
            if (destSamples[i] != nullptr)
            {
                memcpy(destSamples[i] + writePos,
                    reservoir.getReadPointer(i) + bufferIndices.getStart(),
                    (size_t)bufferIndices.getLength() * sizeof(float));
            }
        }
    };

    const auto fillReservoir = [this](const juce::int64 startFillAt)
    {
        if (startFillAt >= lengthInSamples)
        {
            bufferedRange = juce::Range<juce::int64>::emptyRange(startFillAt);
            return;
        }

        if (startFillAt != op_pcm_tell(of)) {
            op_pcm_seek(of, startFillAt);
            bufferedRange = juce::Range<juce::int64>::emptyRange(startFillAt);
        }
        else {
            // Continue buffering, reset the bufferedRange, move to the last end
            bufferedRange = juce::Range<juce::int64>::emptyRange(bufferedRange.getEnd());
        }

        // Decode
        int framesRead = 0;
        while (framesRead < frameBufferSize) {
            auto readResult = op_read_float_stereo(of, &buffer[framesRead * numChannels], frameBufferSize - framesRead);
        
            if (readResult <= 0) {
                break;
            }
        
            framesRead += readResult;
        }

        if (framesRead > 0) {
            using Format = juce::AudioData::Format<juce::AudioData::Float32, juce::AudioData::NativeEndian>;
        
            juce::AudioData::deinterleaveSamples(
                juce::AudioData::InterleavedSource<Format> { buffer.getData(), (int)numChannels },
                juce::AudioData::NonInterleavedDest<Format> { reservoir.getArrayOfWritePointers(), (int)numChannels },
                framesRead
            );

            bufferedRange.setLength(framesRead);
        }
    };

    const auto remainingSamples = juce::Reservoir::doBufferedRead(
        rangeToLoad,
        getBufferedRange,
        readFromReservoir,
        fillReservoir
    );

    if (!remainingSamples.isEmpty()) {
        for (int i = numDestChannels; --i >= 0;) {
            if (destSamples[i] != nullptr) {
                juce::zeromem(destSamples[i] + startOffsetInDestBuffer + (remainingSamples.getStart() - startFrameInFile),
                    (size_t)remainingSamples.getLength() * sizeof(int));
            }
        }
    }

    return true;
}

void OpusAudioFormatReader::reallocBuffer()
{
    buffer.realloc(frameBufferSize * numChannels, sizeof(float));
    nonInterleavedBuffer.setSize(numChannels, frameBufferSize);
}

int OpusAudioFormatReader::ioRead(void* _stream, unsigned char* _ptr, int _nbytes)
{
    auto inst = (OpusAudioFormatReader*)_stream;

    if (!inst) {
        return OP_EFAULT;
    }

    return inst->input->read(_ptr, _nbytes);
}

int OpusAudioFormatReader::ioSeek(void* _stream, opus_int64 _offset, int _whence)
{
    auto inst = (OpusAudioFormatReader*)_stream;

    if (!inst) {        
        return -1;
    }

    opus_int64 new_position = -1;

    switch (_whence) {
    case SEEK_CUR:
        new_position = inst->input->getPosition() + _offset;
        break;
    case SEEK_END:
        new_position = inst->input->getTotalLength() - _offset;
        break;
    default:
        new_position = _offset;
    }

    if (new_position < 0) {
        return -1;
    }

    return inst->input->setPosition(new_position) ? 0 : -1;
}

opus_int64 OpusAudioFormatReader::ioTell(void* _stream)
{
    auto inst = (OpusAudioFormatReader*)_stream;

    if (!inst) {
        return -1;
    }

    return inst->input->getPosition();
}
