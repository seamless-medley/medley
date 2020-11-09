#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

#include "TrackBuffer.h"

using namespace juce;

class TrackPointer;

class QObject {

};

class EngineObject : public QObject {

};

// Load, Decode
// Play, Stop, 
class EngineBuffer : public EngineObject {

};


class EngineChannel : public EngineObject {
    virtual EngineBuffer* getEngineBuffer() = 0;
};

class EnginePregain : public EngineObject {

};

class EngineDeck : public EngineChannel {
    // Use EnginePregain
};

class BasePlayer {

};

class BaseTrackPlayer : public BasePlayer {
    virtual TrackPointer getLoadedTrack() const = 0;
};

class BaseTrackPlayerImpl : public BaseTrackPlayer {
    virtual EngineDeck* getEngineDeck() const = 0;
};

//// [consolidate]
//class Deck : public BaseTrackPlayerImpl {
//    // change constructor
//
//};


// [not_needed]
class PreviewDeck : public BaseTrackPlayerImpl {
    // change constructor
};

// [not_needed]
class Sampler : public BaseTrackPlayerImpl {
    // change constructor
};

// AKA AudioSourcePlayer, Medley
class EngineMaster : public QObject {
    virtual void addChannel(EngineChannel* pChannel) = 0;

    // Processes active channels. The master sync channel (if any) is processed
    // first and all others are processed after. Populates m_activeChannels,
    // m_activeBusChannels, m_activeHeadphoneChannels, and
    // m_activeTalkoverChannels with each channel that is active for the
    // respective output.
    virtual void processChannels(int iBufferSize) = 0;
};


////////////////////////////////////////////////////////

//class Track : public QObject {
//    // construct with TrackFile
//
//    // channels
//    // sample rate
//    // bit rate
//    // duration
//    // replay gain value
//    // tags
//    // cue points
//    // wave form
//};

// Typed Pointer to Track
class TrackPointer {

};


class TrackFile {
    // contain file path string
};


////////////////////////////////////////////////////////

class DeckAttributes : public QObject {
    // wrap around  BaseTrackPlayer
    // watch for events from BaseTrackPlayer
    // export controls (play, stop, positions)
    // fading position
    // originated/destinated
    //
};

// used by AutoDJFeature, which will be 
class AutoDJProcessor : public QObject {
    // watch for events from DeckAttributes
};


////////////////////////////////////////////////////////

// Represent Database Record
class TrackRecord final {
    // TrackMetadata
};

class TrackMetadata final {
    // TrackInfo
    // AlbumInfo
    // Audio properties
    // Duration
};

class TrackInfo {
    // Tags
    // Replay Gain
};


///////////////////////////////////////////////////////
// Signal flows
//  ------------------ trackLoaded ----------------
// 
// CachingReaderWorker::run() // Run by EngineWorkerScheduler, which in turn is registered by EngineBuffer
// [Invoke] CachingReaderWorker::loadTrack =>
// [Signal] CachingReaderWorker::trackLoaded =>
// [Signal] CachingReader::trackLoaded =>
// [Slot] EngineBuffer::slotTrackLoaded =>
// [Invoke] EngineBuffer::notifyTrackLoaded
// [Signal] EngineBuffer::trackLoaded =>
// [Slot] BaseTrackPlayerImpl::slotTrackLoaded =>
//  [Signal] Deck::newTrackLoaded =>
//  [Slot] PlayerManager::slotAnalyzeTrack => 
//  [Invoke] TrackAnalysisScheduler::scheduleTrackById() // Push track into queue
//      Analyze various aspects of a track
//      For any idling TrackAnalysisScheduler::Worker, fetch next track from queue then submit the track to Worker.
//          [Invoke] AnalyzerThread::submitNextTrack() // Wake up the thread
//              Initialize Analyzers
//                  Wave form (From PlayerManager only)
//                  ReplayGain 1.0 (Disabled by default)
//                  ReplayGain 2.0 (Enabled by default)
//                  Beats
//                  Key
//                  Silence
//              AnalyzerThread::analyzeAudioSource()
//                  read audio block from source
//                  pass it to each Analyzer's processSamples()
//                  repeat until finish reading
//                  storeResults()
//                  cleanup()
//                  
//
//  [Signal] BaseTrackPlayer::newTrackLoaded =>
//  [Slot] DeckAttributes::slotTrackLoaded =>
//  [Signal] DeckAttributes::trackLoaded =>
//  [Slot] AutoDJProcessor::playerTrackLoaded // then calculate transition

////////////////////////////////////////////////////////

namespace medley {
    class ITrack : public ReferenceCountedObject {
    public:
        virtual String getFullPath() const = 0;
        // TODO: ReplayGain

        using Ptr = ReferenceCountedObjectPtr<ITrack>;        
    };

    class ITrackMetadata {

    };

    class IQueue {
    public:
        virtual size_t count() const = 0;
        virtual ITrack::Ptr fetchNextTrack() = 0;
    };

    class Medley : public Deck::Callback {
    public:

        Medley(IQueue& queue)
            :
            queue(queue),
            loadingThread("Loading Thread"),
            readAheadThread("Read-ahead-thread")
        {
            deviceMgr.initialise(0, 2, nullptr, true, {}, nullptr);
            auto audioSetup = deviceMgr.getAudioDeviceSetup();
            audioSetup.bufferSize = audioSetup.sampleRate * 0.25;
            deviceMgr.setAudioDeviceSetup(audioSetup, false);

            formatMgr.registerBasicFormats();

            deck1 = new Deck(formatMgr, loadingThread, readAheadThread);
            deck2 = new Deck(formatMgr, loadingThread, readAheadThread);

            deck1->addListener(this);
            deck2->addListener(this);

            loadingThread.startThread();
            readAheadThread.startThread(8);

            mixer.addInputSource(deck1, false);
            mixer.addInputSource(deck2, false);

            mainOut.setSource(&mixer);
            deviceMgr.addAudioCallback(&mainOut);          

            loadNextTrack();
        }

        void loadNextTrack() {
            auto deck = !deck1->isTrackLoaded() ? deck1 : (!deck2->isTrackLoaded() ? deck2 : nullptr);

            if (deck && queue.count() > 0) {
                auto track = queue.fetchNextTrack();

                DBG("[loadNextTrack] " + track->getFullPath() + ", Using deck" + (deck == deck1 ? "1" : "2"));

                deck->loadTrack(track->getFullPath(), true);
            }            
        }

        void finished(Deck& sender) override {
            loadNextTrack();
        }

        void unloaded(Deck& sender) override {

        }

        ~Medley() {
            mixer.removeAllInputs();
            mainOut.setSource(nullptr);

            delete deck1;
            delete deck2;

            loadingThread.stopThread(100);
            readAheadThread.stopThread(100);
            deviceMgr.closeAudioDevice();
        }

        AudioDeviceManager deviceMgr;
        AudioFormatManager formatMgr;
        Deck* deck1 = nullptr;
        Deck* deck2 = nullptr;
        MixerAudioSource mixer;
        AudioSourcePlayer mainOut;

        TimeSliceThread loadingThread;
        TimeSliceThread readAheadThread;

        IQueue& queue;
    };
}

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

    medley::Medley medle(queue);


    static_cast<void>(getchar());
}
