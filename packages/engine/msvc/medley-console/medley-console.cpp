#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

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

class EngineDeck : public EngineChannel {

};

class BasePlayer {

};

class BaseTrackPlayer : public BasePlayer {
    virtual TrackPointer getLoadedTrack() const = 0;
};

class BaseTrackPlayerImpl : public BaseTrackPlayer {
    virtual EngineDeck* getEngineDeck() const = 0;
};

// [consolidate]
class Deck : public BaseTrackPlayerImpl {
    // change constructor

};


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

class Track : public QObject {
    // construct with TrackFile

    // channels
    // sample rate
    // bit rate
    // duration
    // replay gain value
    // tags
    // cue points
    // wave form
};

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

    class TrackSource : public AudioTransportSource {
    public:
        TrackSource(AudioFormatManager* formatMgr, const File& file) {
            reader = formatMgr->createReaderFor(file);
            formatSource = new AudioFormatReaderSource(reader, false);
            setSource(formatSource);
        }

        ~TrackSource() {
            setSource(nullptr);
            delete formatSource;
            delete reader;
        }

        void setPositionFractional(double fraction) {
            setPosition(getLengthInSeconds() * fraction);
        }

        AudioFormatReader* reader = nullptr;
        AudioFormatReaderSource* formatSource = nullptr;
    };

    class Medley {
    public:

        Medley() {
            deviceMgr.initialise(0, 2, nullptr, true, {}, nullptr);
            formatMgr.registerBasicFormats();

            OPENFILENAMEW of{};
            wchar_t files[512]{};

            of.lStructSize = OPENFILENAME_SIZE_VERSION_400W;
            of.hwndOwner = 0;
            of.lpstrFilter = nullptr;
            of.nFilterIndex = 1;
            of.lpstrFile = files;
            of.nMaxFile = 32768;
            of.lpstrInitialDir = nullptr;
            of.lpstrTitle = L"Open file";
            of.Flags = OFN_EXPLORER | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_HIDEREADONLY | OFN_ENABLESIZING;

            if (GetOpenFileName(&of)) {
                fileSource = new TrackSource(&formatMgr, File(files));
                fileSource->start();
                mixer.addInputSource(fileSource, true);
            }
            
            mainOut.setSource(&mixer);

            deviceMgr.addAudioCallback(&mainOut);
        }

        ~Medley() {
            deviceMgr.closeAudioDevice();
        }

        AudioDeviceManager deviceMgr;
        AudioFormatManager formatMgr;
        TrackSource* fileSource;
        MixerAudioSource mixer;
        AudioSourcePlayer mainOut;
    };
}

int main()
{
    static_cast<void>(::CoInitialize(nullptr));
    medley::Medley medley;
    static_cast<void>(getchar());
}
