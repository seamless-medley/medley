#include <napi.h>
#include <Windows.h>
#include "Medley.h"

using namespace Napi;

class Track : public medley::ITrack {
public:
    Track(File& file)
        :
        file(file)
    {

    }

    File& getFile() override {
        return file;
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

Object Init(Env env, Object exports)
{
    static_cast<void>(::CoInitialize(nullptr));

    File f("log.txt");
    FileLogger fl(f, "");
    Logger::setCurrentLogger(&fl);

    Queue* queue = new Queue();
    medley::Medley* medley = new medley::Medley(*queue);

    File file(LR"(D:\Google Drive\musics\new-released\Maiyarap,MILLI - แฟนใหม่หน้าคุ้น.mp3)");
    queue->tracks.push_back(new Track(file));

    Logger::writeToLog(juce::String::formatted("queue.tracks=%d", queue->tracks.size()));
    medley->play();

    Logger::writeToLog("Exported");
    while (true);;

    return exports;
}

NODE_API_MODULE(medley, Init)