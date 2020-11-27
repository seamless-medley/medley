#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

#include "Medley.h"

using namespace juce;
using namespace medley;

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

class MedleyApp : public JUCEApplication {
public:
    void initialise(const String& commandLine) override
    {
        myMainWindow.reset(new MainWindow());
        myMainWindow->setVisible(true);
    }

    void shutdown() override {
        myMainWindow = nullptr;
    }

    const juce::String getApplicationName() override { return "Medley Playground"; }

    const juce::String getApplicationVersion() override { return "0.1.0"; }

private:

    class PlayHead : public Component {
    public:
        PlayHead(Deck* deck, Deck* anotherDeck)
            :
            deck(deck),
            anotherDeck(anotherDeck)
        {

        }

        void updateDecks(Deck* deck, Deck* anotherDeck) {
            this->deck = deck;
            this->anotherDeck = anotherDeck;
        }      

        void paint(Graphics& g) override {
            if (!deck->isTrackLoaded()) {
                return;
            }

            auto w = (float)getWidth();
            auto h = (float)getHeight();

            // container
            g.setColour(Colours::lightgrey.darker(0.22f));
            g.fillRect(0.0f, 0.0f, w, h);

            // progress
            auto pos = (float)deck->getPositionInSeconds();
            auto duration = (float)deck->getDuration();

            if (duration <= 0) {
                return;
            }

            g.setColour(Colours::green);
            g.fillRect(0.0f, 0.0f, (pos / duration) * w, h);

            auto sr = deck->getSourceSampleRate();
            auto first = deck->getFirstAudiblePosition();
            auto last = deck->getEndPosition();

            auto leading = deck->getLeadingSamplePosition() / sr;
            auto trailing = deck->getTrailingSamplePosition() / sr;

            auto nextLeading = (float)((anotherDeck->isTrackLoaded() && !anotherDeck->isMain()) ? anotherDeck->getLeadingDuration() : 0);
            //
            auto cuePoint = deck->getTransitionCuePosition();
            auto transitionStart = (float)deck->getTransitionStartPosition() - nextLeading;
            auto transitionEnd = (float)deck->getTransitionEndPosition();

            g.fillCheckerBoard(
                juce::Rectangle(
                    0.0f, 0.0f,
                    (float)(first / duration * w), h
                ), 4, 4, Colours::darkgrey, Colours::darkgrey.darker()
            );

            g.fillCheckerBoard(
                juce::Rectangle(
                    (float)(transitionEnd / duration * w), 0.0f,
                    (float)(last / duration * w), h
                ),
                4, 4, Colours::darkorchid, Colours::darkorchid.darker()
            );

            g.fillCheckerBoard(
                juce::Rectangle(
                    (float)(last / duration * w), 0.0f,
                    w, h
                ),
                4, 4, Colours::darkgrey, Colours::darkgrey.darker()
            );

            // cue
            g.setColour(Colours::yellow);
            g.drawVerticalLine((int)(cuePoint / duration * w), 0, h);

            // transition
            {
                g.setGradientFill(ColourGradient(
                    Colours::hotpink.withAlpha(0.4f), transitionStart / duration * w, 0,
                    Colours::lightpink.withAlpha(0.7f), transitionEnd / duration * w, 0,
                    false
                ));
                g.fillRect(
                    transitionStart / duration * w, 0.0f,
                    (transitionEnd - transitionStart) / duration * w, h
                );
            }

            // leading
            g.setColour(Colours::palevioletred);
            g.drawVerticalLine((int)(leading / duration * w), 0, w);

            // trailing
            g.setColour(Colours::orangered);
            g.drawVerticalLine((int)(trailing / duration * w), 0, w);
        }

        void mouseDown(const MouseEvent& event) override {
            deck->setPositionFractional((double)event.getMouseDownX() / getWidth());
        }

        medley::Deck* deck;
        medley::Deck* anotherDeck;
    };
    
    class DeckComponent : public Component, public Deck::Callback {
    public:
        DeckComponent(Deck& deck, Deck& anotherDeck)
            :
            deck(deck),
            playhead(&deck, &anotherDeck)
        {
            deck.addListener(this);

            addAndMakeVisible(playhead);
        }

        ~DeckComponent() override {
            deck.removeListener(this);
        }

        void deckTrackScanning(Deck& sender) override {

        }

        void deckTrackScanned(Deck& sender) override  {

        }

        void deckPosition(Deck& sender, double position) override {

        }

        void deckStarted(Deck& sender) override {

        }

        void deckFinished(Deck& sender) override {

        }

        void deckLoaded(Deck& sender) override {
            
        }

        void deckUnloaded(Deck& sender) override {

        }

        void resized() {
            auto b = getLocalBounds();
            playhead.setBounds(b.removeFromBottom(24));
        }

        void paint(Graphics& g) override {
            if (deck.isMain()) {
                g.setColour(Colours::antiquewhite);
            }
            else if (deck.isTrackLoaded()) {
                g.setColour(deck.isPlaying() ? Colours::lightseagreen : Colours::lightsalmon);
            }
            else {
                g.setColour(Colours::lightgrey);
            }

            g.fillRect(0, 0, getWidth(), getHeight());
            g.setColour(Colours::black);

            if (auto track = deck.getTrack()) {               
                auto lineHeight = (int)g.getCurrentFont().getHeight();
                auto b = getLocalBounds().reduced(4);
                auto topLine = b.removeFromTop(lineHeight);

                auto pos = deck.getPositionInSeconds();
                auto posStr = String::formatted("%.2d:%.2d.%.3d", (int)pos / 60, (int)pos % 60, (int)(pos * 1000) % 1000);

                g.drawText(posStr, topLine.removeFromRight(120), Justification::topRight);
                g.drawText(track->getFile().getFileName(), topLine, Justification::topLeft);

                {
                    auto thisLine = b.removeFromTop(lineHeight);
                    g.drawText(String::formatted("Volume: %d%%", (int)(deck.getVolume() * 100)), thisLine, Justification::topLeft);
                }
            }
        }

        medley::Deck& deck;
        PlayHead playhead;
    };

    class VUMeter : public Component {
    public:
        VUMeter(Medley& medley)
            : medley(medley)
        {

        }

        void resized() {
            auto b = getLocalBounds();
            gradient = ColourGradient(
                Colours::green, 0.0f, 0.0f,
                Colours::red, (float)b.getWidth(), 0.0f,
                false
            );

            gradient.addColour(0.90, Colours::green);
            gradient.addColour(0.95, Colours::yellow);
        }

        void paint(Graphics& g) override {
            g.setColour(Colours::lightgrey);
            g.fillAll();

            g.setColour(Colours::green);

            auto h = (float)getHeight();
            auto mh = h / 2.0f;

            auto peakLeft = Decibels::gainToDecibels(medley.getPeakLevel(0));
            auto peakRight = Decibels::gainToDecibels(medley.getPeakLevel(1));

            g.setGradientFill(gradient);
            g.fillRect(0.0f, 0.0f, (float)(getWidth() * (1 + Decibels::gainToDecibels(medley.getLevel(0)) / 100)), mh);
            g.fillRect(0.0f, mh, (float)(getWidth() * (1 + Decibels::gainToDecibels(medley.getLevel(1)) / 100)), mh);

            auto getPeakColour = [](double db) {
                if (db > -3.0) return Colours::red;
                if (db > -5.0) return Colours::yellow;
                return Colours::white;
            };

            g.setColour(getPeakColour(peakLeft));
            g.drawVerticalLine((int)(getWidth() * (1 + peakLeft / 100)) - 1, 0, mh);
           

            g.setColour(getPeakColour(peakRight));
            g.drawVerticalLine((int)(getWidth() * (1 + peakRight / 100)) - 1, mh, h);
        }

    private:
        Medley& medley;
        ColourGradient gradient;
    };

    class QueueModel : public ListBoxModel {
    public:
        QueueModel(Queue& queue)
            : queue(queue)
        {
            
        }

        int getNumRows() override
        {
            return (int)queue.count();
        }

        void paintListBoxItem(int rowNumber, Graphics& g, int width, int height, bool rowIsSelected) override {
            if (rowIsSelected) {
                g.fillAll(Colours::lightblue);
            }

            g.setColour(LookAndFeel::getDefaultLookAndFeel().findColour(Label::textColourId));            

            if (rowNumber < (int)queue.tracks.size()) {
                auto at = std::next(queue.tracks.begin(), rowNumber);
                if (at != queue.tracks.end()) {
                    g.drawText(at->get()->getFile().getFullPathName(), 0, 0, width, height, Justification::centredLeft, false);
                }
            }
        }

    private:
        Queue& queue;
    };

    class MainContentComponent : public Component, public Timer, public Button::Listener, public Slider::Listener, public medley::Medley::Callback {
    public:
        MainContentComponent() :
            Component(),
            model(queue),
            medley(queue),
            queueListBox({}, &model),
            btnAdd("Add"),
            btnPlay("Play"),
            btnStop("Stop"),
            btnPause("Pause"),
            btnFadeOut("Fade Out"),
            volumeText({}, "Volume:")
        {
            medley.addListener(this);

            deckA = new DeckComponent(medley.getDeck1(), medley.getDeck2());
            addAndMakeVisible(deckA);

            deckB = new DeckComponent(medley.getDeck2(), medley.getDeck1());
            addAndMakeVisible(deckB);

            btnAdd.addListener(this);
            addAndMakeVisible(btnAdd);

            btnPlay.addListener(this);
            addAndMakeVisible(btnPlay);

            btnStop.addListener(this);
            addAndMakeVisible(btnStop);

            btnPause.addListener(this);
            addAndMakeVisible(btnPause);

            btnFadeOut.addListener(this);
            addAndMakeVisible(btnFadeOut);

            addAndMakeVisible(volumeText);
            volumeText.setColour(Label::textColourId, Colours::black);

            addAndMakeVisible(volumeSlider);
            volumeSlider.setTextBoxStyle(Slider::TextEntryBoxPosition::NoTextBox, "", 0, 0);
            volumeSlider.setTextValueSuffix("dB");
            volumeSlider.setRange(0.0, 1.0);
            volumeSlider.setValue(medley.getGain());
            volumeSlider.addListener(this);            

            playhead = new PlayHead(&medley.getDeck1(), &medley.getDeck2());
            addAndMakeVisible(playhead);

            {
                auto& types = medley.getAvailableDeviceTypes();
                for (int i = 0; i < types.size(); i++) {
                    comboDeviceTypes.addItem(types.getUnchecked(i)->getTypeName(), i + 1);
                }

                comboDeviceTypes.setText(medley.getCurrentAudioDeviceType()->getTypeName(), dontSendNotification);
                addAndMakeVisible(comboDeviceTypes);
                comboDeviceTypes.onChange = [this] { updateDeviceType();  };

                addAndMakeVisible(comboDeviceNames);
                comboDeviceNames.onChange = [this] { updateDevice(); };

                updateDeviceType();

                vuMeter = new VUMeter(medley);
                addAndMakeVisible(vuMeter);
            }            

            queueListBox.setColour(ListBox::outlineColourId, Colours::grey);
            addAndMakeVisible(queueListBox);

            setSize(800, 600);

            startTimerHz(40);
        }

        int lastQueueCount = 0;

        void timerCallback() override {
            deckA->repaint();
            deckB->repaint();
            playhead->repaint();
            vuMeter->repaint();

            updatePlayButton();

            if (queue.count() != lastQueueCount) {
                queueListBox.deselectAllRows();
                queueListBox.updateContent();

                lastQueueCount = (int)queue.count();
            }
        }

        void updateDeviceType() {
            if (auto type = medley.getAvailableDeviceTypes()[comboDeviceTypes.getSelectedId() - 1])
            {
                medley.setCurrentAudioDeviceType(*type);
                comboDeviceTypes.setText(type->getTypeName());

                comboDeviceNames.clear(dontSendNotification);

                auto names = type->getDeviceNames(false);
                for (int i = 0; i < names.size(); i++) {
                    comboDeviceNames.addItem(names[i], i + 1);
                }

                comboDeviceNames.setSelectedId(medley.getIndexOfCurrentDevice() + 1);
            }
        }

        void updateDevice() {
            medley.setAudioDeviceByIndex(comboDeviceNames.getSelectedId() - 1);
        }

        void resized() override {
            auto b = getLocalBounds();
            {
                auto devicePanelArea = b.removeFromTop(34).reduced(10, 2);
                comboDeviceTypes.setBounds(devicePanelArea.removeFromLeft(250));
                comboDeviceNames.setBounds(devicePanelArea.removeFromLeft(250).translated(4, 0));
                vuMeter->setBounds(devicePanelArea.reduced(4, 0).translated(4, 0));
            }
            {
                auto deckPanelArea = b.removeFromTop(120).reduced(10, 2);
                auto w = (deckPanelArea.getWidth() - 10) / 2;
                deckA->setBounds(deckPanelArea.removeFromLeft(w));
                deckB->setBounds(deckPanelArea.translated(10, 0).removeFromLeft(w));
            }
            {
                playhead->setBounds(b.removeFromTop(32).translated(0, 4).reduced(10, 4));
            }
            {
                auto controlArea = b.removeFromTop(32).translated(0, 4).reduced(10, 4);
                btnAdd.setBounds(controlArea.removeFromLeft(55));
                btnPlay.setBounds(controlArea.removeFromLeft(55));
                btnStop.setBounds(controlArea.removeFromLeft(55));
                btnPause.setBounds(controlArea.removeFromLeft(75));
                btnFadeOut.setBounds(controlArea.removeFromLeft(60));
                volumeText.setBounds(controlArea.removeFromLeft(60));
                volumeSlider.setBounds(controlArea.reduced(4, 0));
            }
            {
                queueListBox.setBounds(b.reduced(10));
            }
        }

        ~MainContentComponent() {
            medley.removeListener(this);

            removeChildComponent(deckA);
            removeChildComponent(deckB);
            removeChildComponent(playhead);
            removeChildComponent(vuMeter);

            delete deckA;
            delete deckB;
            delete playhead;
            delete vuMeter;
        }

        void buttonClicked(Button* source) override {
            if (source == &btnAdd) {
                FileChooser fc("test");

                if (fc.browseForMultipleFilesToOpen()) {
                    auto files = fc.getResults();

                    for (auto f : files) {
                        queue.tracks.push_back(new Track(f));
                    }

                    // medley.play();
                    queueListBox.updateContent();
                }

                return;
            }

            if (source == &btnPlay) {
                medley.play();
                updatePauseButton();
                return;
            }

            if (source == &btnStop) {
                medley.stop();
                return;
            }

            if (source == &btnPause) {
                medley.togglePause();
                updatePauseButton();
                return;
            }

            if (source == &btnFadeOut) {
                medley.fadeOutMainDeck();
            }
        }

        void sliderValueChanged(Slider* slider) override {
            if (slider == &volumeSlider) {
                medley.setGain((float)slider->getValue());
            }
        }

        void deckTrackScanning(Deck& sender) override {

        }

        void deckTrackScanned(Deck& sender) override {

        }

        void deckPosition(Deck& sender, double position) override {
            
        }

        void deckStarted(Deck& sender) override {
            
        }

        void deckFinished(Deck& sender) override {
            
        }

        void updatePauseButton() {
            btnPause.setButtonText(medley.isPaused() ? "Paused" : "Pause");
        }

        void updatePlayButton() {
            btnPlay.setColour(TextButton::buttonColourId, medley.isDeckPlaying() ? Colours::lightgreen : getLookAndFeel().findColour(TextButton::buttonColourId));
            updatePauseButton();
        }

        void deckLoaded(Deck& sender) override {
            if (auto deck = medley.getMainDeck()) {
                auto anotherDeck = medley.getAnotherDeck(deck);
                playhead->updateDecks(deck, anotherDeck);
            }                      
        }

        void deckUnloaded(Deck& sender) override {
            if (auto deck = medley.getMainDeck()) {
                auto anotherDeck = medley.getAnotherDeck(deck);
                playhead->updateDecks(deck, anotherDeck);
            }
        }

        TextButton btnAdd;
        TextButton btnPlay;
        TextButton btnStop;
        TextButton btnPause;
        TextButton btnFadeOut;

        Label volumeText;
        Slider volumeSlider;

        ListBox queueListBox;

        PlayHead* playhead = nullptr;

        DeckComponent* deckA = nullptr;
        DeckComponent* deckB = nullptr;

        ComboBox comboDeviceTypes;
        ComboBox comboDeviceNames;

        VUMeter* vuMeter = nullptr;

        Queue queue;
        QueueModel model;
        medley::Medley medley;
    };

    class MainWindow : public DocumentWindow {
    public:
        explicit MainWindow()
            : DocumentWindow("Medley Playground", Colours::white, DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);
            setContentOwned(new MainContentComponent(), true);
            setBounds(100, 50, 800, 600);
            setResizable(true, false);
            setVisible(true);

            LookAndFeel::getDefaultLookAndFeel().setDefaultSansSerifTypefaceName("Tahoma");
        }

        void closeButtonPressed() override
        {
            JUCEApplication::getInstance()->systemRequestedQuit();
        }        
    };

    std::unique_ptr<MainWindow> myMainWindow;
};

juce::JUCEApplicationBase* createApplication() {
    return new MedleyApp();
}

int main()
{
    static_cast<void>(::CoInitialize(nullptr));

    juce::JUCEApplicationBase::createInstance = &createApplication;
    return juce::JUCEApplicationBase::main();

    static_cast<void>(getchar());
}
