#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

#include "Medley.h"

using namespace juce;

int main()
{
    static_cast<void>(::CoInitialize(nullptr));

    class Track : public medley::ITrack {
    public:
        Track(File& file)
            :
            file(file)
        {

        }

        String getFullPath() const {
            return file.getFullPathName();
        }

    private:
        JUCE_LEAK_DETECTOR(Track)

        File file;
    };

    class Queue : public medley::IQueue {
    public:
        size_t count() const override {
            return tracks.size();
        }

        medley::ITrack::Ptr fetchNextTrack() {
            auto track = tracks.front();
            tracks.erase(tracks.begin());
            return track;
        }

        std::list<Track::Ptr> tracks;
    };

    Queue queue;

    OPENFILENAMEW of{};
    HeapBlock<WCHAR> files;

    files.calloc(static_cast<size_t> (32768) + 1);

    of.lStructSize = OPENFILENAME_SIZE_VERSION_400W;
    of.hwndOwner = 0;
    of.lpstrFilter = nullptr;
    of.nFilterIndex = 1;
    of.lpstrFile = files;
    of.nMaxFile = 32768;
    of.lpstrInitialDir = nullptr;
    of.lpstrTitle = L"Open file";
    of.Flags = OFN_EXPLORER | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_HIDEREADONLY | OFN_ENABLESIZING | OFN_ALLOWMULTISELECT;    

    if (GetOpenFileName(&of)) {
        if (of.nFileOffset > 0 && files[of.nFileOffset - 1] == 0) {
            const wchar_t* filename = files + of.nFileOffset;


            while (*filename != 0)
            {
                queue.tracks.push_back(new Track(File(String(files.get())).getChildFile(String(filename))));
                filename += wcslen(filename) + 1;
            }
        }
        else {
            queue.tracks.push_back(new Track(File(String(files.get()))));
        }
    }

    medley::Medley medley(queue);


    static_cast<void>(getchar());
}
