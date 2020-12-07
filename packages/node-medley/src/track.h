#pragma once

#include <napi.h>
#include "Medley.h"

class Track : public medley::ITrack {
public:
    Track()
    {

    }

    Track(File& file, float preGain = 1.0f)
        : file(file), preGain(preGain)
    {

    }

    Track(juce::String& path, float preGain = 1.0f)
        : Track(File(path), preGain)
    {

    }

    Track(const Track& other)
        : file(other.file), preGain(other.preGain)
    {

    }

    Track(Track&& other)
        : file(std::move(other.file)), preGain(other.preGain)
    {

    }

    File getFile() {
        return file;
    }

    float getPreGain() const { return preGain; }

private:
    File file;
    float preGain = 1.0f;
};
