#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

#include "Deck.h"

using namespace juce;

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

////////////////////////////////////////////////////////


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
            updateFadingFactor();

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

            loadNextTrack(nullptr, true);
        }

        bool loadNextTrack(Deck* currentDeck, bool play) {
            auto deck = getAnotherDeck(currentDeck);

            if (deck && queue.count() > 0) {
                auto track = queue.fetchNextTrack();
                deck->loadTrack(track->getFullPath(), play);
                return true;
            }

            return false;
        }

        Deck* getAvailableDeck() {
            return !deck1->isTrackLoaded() ? deck1 : (!deck2->isTrackLoaded() ? deck2 : nullptr);
        }

        Deck* getAnotherDeck(Deck* from) {
            if (from == nullptr) {
                return getAvailableDeck();
            }

            return (from == deck1) ? deck2 : deck1;
        }

        String getDeckName(Deck& deck) {
            return String("deck") + String(&deck == deck1 ? "1" : "2");
        }

        void deckStarted(Deck& sender) override {
            DBG("[deckStarted] " + getDeckName(sender));
        }

        void deckFinished(Deck& sender) override {
            
        }

        void deckUnloaded(Deck& sender) override {
            if (&sender == transitingDeck) {
                transitionState = TransitionState::Idle;
            }
        }

        void deckPosition(Deck& sender, double position) override {
            if (transitionState == TransitionState::Transit) {

            }

            auto nextDeck = getAnotherDeck(&sender);
            if (nextDeck == nullptr) {
                return;
            }

            if (transitionState == TransitionState::Idle) {
                if (position > sender.getTransitionCuePosition()) {
                    DBG("CUE NEXT");
                    transitionState = TransitionState::Cue;
                    if (!loadNextTrack(&sender, false)) {
                        // No more track, do not transit
                        return;
                    }
                }
            }

            auto transitionStartPos = sender.getTransitionStartPosition();
            auto transitionEndPos = sender.getTransitionEndPosition();

            if (position > transitionStartPos) {
                if (transitionState != TransitionState::Transit) {
                    if (nextDeck->isTrackLoaded()) {
                        DBG("TRANSIT");
                        transitionState = TransitionState::Transit;
                        transitingDeck = &sender;
                        nextDeck->start();
                    }
                }

                auto transitionProgress = jlimit(0.0, 1.0, (position - transitionStartPos) / (transitionEndPos - transitionStartPos));
                sender.setVolume(pow(1.0 - transitionProgress, fadingFactor));
            }
        }

        double getFadingCurve() const {
            return fadingCurve;
        }

        void setFadingCurve(double curve) {
            fadingCurve = jlimit(0.0, 100.0, curve);
            updateFadingFactor();
        }

        void updateFadingFactor() {
            double outRange = 1000.0 - 1.0;
            double inRange = 100.0;
            fadingFactor = 1000.0 / (((100.0 - fadingCurve) / inRange * outRange) + 1.0);
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

        enum class TransitionState {
            Idle,
            Cue,
            Transit
        };

        TransitionState transitionState = TransitionState::Idle;
        Deck* transitingDeck = nullptr;

        double fadingCurve = 80;
        float fadingFactor;
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
