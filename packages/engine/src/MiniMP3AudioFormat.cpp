#include "MiniMP3AudioFormat.h"
#include "MiniMP3AudioFormatReader.h"

AudioFormatReader* MiniMP3AudioFormat::createReaderFor(InputStream* sourceStream, bool deleteStreamIfOpeningFails)
{
    std::unique_ptr<MiniMP3AudioFormatReader> r(new MiniMP3AudioFormatReader(sourceStream));

    if (r->lengthInSamples > 0)
        return r.release();

    if (!deleteStreamIfOpeningFails)
        r->input = nullptr;

    return nullptr;
}
