#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>
#include <random>
#include <algorithm>

#include "Medley.h"

#include <juce_opengl/juce_opengl.h>

using namespace juce;
using namespace medley;

class ConsoleLogger : public Logger {
public:
    ConsoleLogger()
    {
        out = GetStdHandle(STD_OUTPUT_HANDLE);
    }
protected:
    void logMessage(const String& message) override {
        String line(message + "\n");
        if (out != NULL && out != INVALID_HANDLE_VALUE) {
            DWORD written = 0;
            WriteConsole(out, line.toWideCharPointer(), line.length(), &written, nullptr);
        }
        else {
            OutputDebugString(line.toWideCharPointer());
        }
    }

    HANDLE out = INVALID_HANDLE_VALUE;
};

class Track : public medley::ITrack {
public:
    Track(File& file)
        :
        file(file)
    {

    }

    File getFile() override {
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
        logger = std::make_unique<ConsoleLogger>();

        ConsoleLogger::setCurrentLogger(logger.get());
        myMainWindow.reset(new MainWindow());
        myMainWindow->setVisible(true);
    }

    void shutdown() override {
        myMainWindow = nullptr;
        logger.release();
    }

    const juce::String getApplicationName() override { return "Medley Playground"; }

    const juce::String getApplicationVersion() override { return "0.1.0"; }

private:

    std::unique_ptr<ConsoleLogger> logger;

    class PlayHead : public Component, public ChangeListener {
    public:
        class Callback {
        public:
            virtual void getDecks(Deck** pDeck, Deck** pAnotherDeck) = 0;
            virtual AudioThumbnail* getThumbnail(Deck* deck) = 0;
            virtual void playHeadSeek(double progress) = 0;
        };

        class ResizeHandler : public AsyncUpdater {
        public:
            ResizeHandler(PlayHead& owner)
                : owner(owner)
            {

            }

            void handleAsyncUpdate() override {
                owner.createThumbImage();
                owner.updateThumbImage();
                owner.repaint();
            }

            PlayHead& owner;
        };

        PlayHead(Callback& callback, TimeSliceThread& thread)
            :
            callback(callback),
            thread(thread),
            resizeHandler(*this)
        {

        }

        void createThumbImage() {
            ScopedLock sl(thumbImageLock);
            auto w = getWidth();
            auto h = getHeight();
            thumbImage = (w > 0 && h > 0) ? Image(Image::PixelFormat::ARGB, w, h, true) : Image();
        }

        void clearThumbImage() {
            juce::Rectangle r(0, 0, getWidth(), getHeight());
            thumbImage.clear(r, Colours::transparentBlack);
        }

        void resized() override {
            resizeHandler.triggerAsyncUpdate();
        }

        void updateThumbImage() {
            ScopedLock sl(thumbImageLock);
            if (lastThumbnailFromCallback && thumbImage.isValid()) {
                clearThumbImage();

                Graphics g(thumbImage);
                g.setColour(Colours::green.withAlpha(0.6f));
                juce::Rectangle r(0, 2, getWidth(), getHeight() - 4);

                Deck* deck = nullptr;
                Deck* anotherDeck = nullptr;

                callback.getDecks(&deck, &anotherDeck);

                lastThumbnailFromCallback->drawChannels(g, r, 0.0, deck ? deck->getDuration() : lastThumbnailFromCallback->getTotalLength(), 1.0f);
            }
        }

        void changeListenerCallback(ChangeBroadcaster* source) {
            ScopedLock sl(thumbImageLock);
            if (source == lastThumbnailFromCallback) {
                updateThumbImage();
                return;
            }
        }

        void detectThumbnail() {
            ScopedLock sl(thumbImageLock);

            Deck* deck = nullptr;
            Deck* anotherDeck = nullptr;

            callback.getDecks(&deck, &anotherDeck);

            if (deck == nullptr) {
                return;
            }

            auto thumbnail = callback.getThumbnail(deck);
            if (thumbnail != lastThumbnailFromCallback) {
                if (lastThumbnailFromCallback != nullptr) {
                    lastThumbnailFromCallback->removeChangeListener(this);
                }

                lastThumbnailFromCallback = thumbnail;

                clearThumbImage();
                updateThumbImage();

                if (thumbnail != nullptr) {
                    thumbnail->addChangeListener(this);
                }
            }
        }

        void paint(Graphics& g) override {
            Deck* deck = nullptr;
            Deck* nextDeck = nullptr;

            callback.getDecks(&deck, &nextDeck);

            if (deck == nullptr) {
                return;
            }

            detectThumbnail();

            if (!deck->isTrackLoaded()) {
                return;
            }

            auto w = (float)getWidth();
            auto h = (float)getHeight();

            // container
            g.setColour(Colours::lightgrey.darker(0.22f));
            g.fillRect(0.0f, 0.0f, w, h);

            // progress
            auto pos = (float)deck->getPosition();
            auto duration = (float)deck->getDuration();

            if (duration <= 0) {
                return;
            }

            auto sr = deck->getSourceSampleRate();
            auto first = deck->getFirstAudiblePosition();
            auto last = deck->getEndPosition();

            auto leading = deck->getLeadingSamplePosition() / sr;
            auto trailing = deck->getTrailingSamplePosition() / sr;

            auto nextLeading = (float)((nextDeck != nullptr && nextDeck->isTrackLoaded() && !nextDeck->isMain()) ? nextDeck->getLeadingDuration() : 0);
            //
            auto cuePoint = deck->getTransitionCuePosition();
            auto transitionStart = (float)deck->getTransitionStartPosition() - nextLeading;
            auto transitionEnd = (float)deck->getTransitionEndPosition();

            juce::Rectangle firstArea(0.0f, 0.0f, (float)(first / duration * w), h);
            juce::Rectangle inaudibleArea((float)(transitionEnd / duration * w), 0.0f, (float)(last / duration * w), h);
            juce::Rectangle lastArea((float)(last / duration * w), 0.0f, w, h);

            g.fillCheckerBoard(firstArea, 4, 4, Colours::darkgrey.brighter(), Colours::darkgrey);
            g.fillCheckerBoard(inaudibleArea, 4, 4, Colours::darkorchid.brighter(), Colours::darkorchid);
            g.fillCheckerBoard(lastArea, 4, 4, Colours::darkgrey.brighter(), Colours::darkgrey);

            // Thumb
            {
                ScopedLock sl(thumbImageLock);
                g.drawImage(thumbImage, 0, 0, (int)w, (int)h, 0, 0, (int)w, (int)h);
            }

            // Masking
            g.setColour(Colours::black.withAlpha(0.5f));
            g.fillRect(firstArea);
            g.fillRect(inaudibleArea);
            g.fillRect(lastArea);

            // Progress
            g.setColour(Colours::black.withAlpha(0.25f));
            if (pos >= 0) {
                g.fillRect(0.0f, 0.0f, (pos / duration) * w, h);
            }

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
            callback.playHeadSeek((double)event.getMouseDownX() / getWidth());
        }

        void mouseDrag(const MouseEvent& event) override {
            callback.playHeadSeek((double)event.getPosition().getX() / getWidth());
        }

        Callback& callback;
        ResizeHandler resizeHandler;
        TimeSliceThread& thread;
        AudioThumbnail* lastThumbnailFromCallback = nullptr;
        Image thumbImage;
        CriticalSection thumbImageLock;
    };

    class DeckComponent : public Component, public Deck::Callback, PlayHead::Callback, TimeSliceClient {
    public:
        class ThumbnailLoader : public TimeSliceClient {
        public:
            ThumbnailLoader(Medley& medley, Deck& deck, AudioThumbnail* thumbnail)
                :
                medley(medley),
                deck(deck),
                thumbnail(thumbnail)
            {

            }

            void load() {
                ScopedLock sl(readerPtrLock);

                if (thumbnail) {
                    if (auto track = deck.getTrack()) {
                        auto file = track->getFile();
                        auto reader = medley.getAudioFormatManager().createReaderFor(file);

                        numSamplesFinished = 0;
                        lengthInSamples = reader->lengthInSamples;

                        readerPtr.reset(reader);
                        thumbnail->reset(1, reader->sampleRate, lengthInSamples);
                    }
                }
            }

            int useTimeSlice() override {
                ScopedLock sl(readerPtrLock);

                if (readerPtr.get() == nullptr) {
                    return -1;
                }

                if (isFullyLoaded()) {
                    readerPtr.reset();
                    return -1;
                }

                AudioBuffer<float> buffer(readerPtr->numChannels, 512 * 256);
                readerPtr->read(&buffer, 0, 512 * 256, numSamplesFinished, true, true);

                if (readerPtr->numChannels > 1) {
                    for (auto i = 1; i < readerPtr->numChannels; i++) {
                        buffer.addFrom(0, 0, buffer, i, 0, 512 * 256);
                    }

                    buffer.applyGain(1.0f / readerPtr->numChannels);
                }

                thumbnail->addBlock(numSamplesFinished, buffer, 0, 512 * 256);

                numSamplesFinished += 512 * 256;

                return isFullyLoaded() ? -1 : 60;
            }

            bool isFullyLoaded() const noexcept
            {
                return numSamplesFinished >= lengthInSamples;
            }

        private:
            Medley& medley;
            medley::Deck& deck;
            AudioThumbnail* thumbnail;
            CriticalSection readerPtrLock;
            std::unique_ptr<AudioFormatReader> readerPtr;
            int64 numSamplesFinished = 0;
            int64 lengthInSamples = 0;
        };

        class ThumbnailCleaner : public TimeSliceClient {
        public:
            ThumbnailCleaner(AudioThumbnail* thumbnail, PlayHead& playhead)
                :
                thumbnail(thumbnail),
                playhead(playhead)
            {

            }

            int useTimeSlice() override {
                if (thumbnail) {
                    thumbnail->clear();
                }
                playhead.clearThumbImage();
                return -1;
            }

            AudioThumbnail* thumbnail;
            PlayHead& playhead;
        };

        DeckComponent(Medley& medley, Deck& deck, Deck& anotherDeck, TimeSliceThread& thread, AudioThumbnail* thumbnail)
            :
            medley(medley),
            deck(deck),
            anotherDeck(anotherDeck),
            playhead(*this, thread),
            thread(thread),
            thumbnail(thumbnail),
            thumbnailLoader(medley, deck, thumbnail),
            thumbnailCleaner(thumbnail, playhead)
        {
            deck.addListener(this);

            addAndMakeVisible(playhead);
        }

        ~DeckComponent() override {
            deck.removeListener(this);
        }

        void getDecks(Deck** pDeck, Deck** pAnotherDeck) override {
            *pDeck = &deck;
            *pAnotherDeck = &anotherDeck;
        }

        AudioThumbnail* getThumbnail(Deck* deck) {
            return deck->isTrackLoaded() ? thumbnail : nullptr;
        }

        void playHeadSeek(double progress) override {
            if (deck.isMain()) {
                medley.setPositionFractional(progress);
            }
            else {
                deck.setPositionFractional(progress);
            }
        }

        void deckTrackScanning(Deck& sender) override {

        }

        void deckTrackScanned(Deck& sender) override  {

        }

        void deckPosition(Deck& sender, double position) override {

        }

        void deckStarted(Deck& sender, TrackPlay& track) override {

        }

        void deckFinished(Deck& sender, TrackPlay& track) override {

        }

        void deckLoaded(Deck& sender, TrackPlay& track) override {
            thread.addTimeSliceClient(this);
            thumbnailLoader.load();
            thread.addTimeSliceClient(&thumbnailLoader);
        }

        void deckUnloaded(Deck& sender, TrackPlay& track) override {
            ScopedLock sl(coverImageLock);
            coverImage = Image();
            thread.addTimeSliceClient(&thumbnailCleaner);
        }

        void resized() {
            auto b = getLocalBounds();
            playhead.setBounds(b.removeFromBottom(35));
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
                ScopedLock sl(coverImageLock);

                auto b = getLocalBounds();
                b.removeFromBottom(35); // playhead

                juce::Rectangle coverContainer(b.toFloat());

                if (coverImage.isValid()) {
                    auto w = jmin((float)b.getWidth(), (float)b.getHeight());

                    auto x = (b.getWidth() - w) / 2.0f;
                    auto y = (b.getHeight() - w) / 2.0f;

                    coverContainer = juce::Rectangle(
                        x, y,
                        w, w
                    );
                }

                if (!coverContainer.isEmpty()) {
                    juce::Rectangle coverArea(coverContainer);

                    if (coverImage.isValid()) {
                        g.drawImageWithin(coverImage, (int)coverContainer.getX(), (int)coverContainer.getY(), (int)coverContainer.getWidth(), (int)coverContainer.getHeight(), RectanglePlacement::centred);

                        auto ratio = coverImage.getBounds().toFloat().getAspectRatio();
                        auto coverAreaWidth = ratio * coverContainer.getHeight();

                        coverArea = juce::Rectangle(((float)b.getWidth() - coverAreaWidth) / 2.0f, coverContainer.getY(), coverAreaWidth, coverContainer.getHeight());
                    }

                    if (coverArea.getWidth() > coverContainer.getWidth()) {
                        coverArea.setWidth(coverContainer.getWidth());
                    }

                    if (coverArea.getX() < coverContainer.getX()) {
                        coverArea.setX(coverContainer.getX());
                    }

                    auto lines = 14;
                    auto fontHeight = coverArea.getHeight() / (float)lines - 2.0f;
                    auto topArea = coverArea.withHeight(fontHeight * (float)lines / 2.0f);
                    auto topInnerArea = topArea.reduced(2);

                    g.setGradientFill(ColourGradient(
                        Colours::black.withAlpha(0.85f), topArea.getX(), topArea.getY(),
                        Colours::transparentBlack, topArea.getX(), topArea.getY() + topArea.getHeight(),
                        false
                    ));
                    g.fillRect(topArea);

                    auto meta = deck.metadata();

                    auto lineX = [topInnerArea, fontHeight](int lineIndex) {
                        return topInnerArea.withY(topInnerArea.getY() + fontHeight * (float)lineIndex);
                    };

                    g.setColour(Colours::white);
                    g.setFont(Font("Sarabun", fontHeight, Font::bold));
                    g.drawText(meta.getTitle(), lineX(0), Justification::topRight);
                    g.setFont(Font("Sarabun", fontHeight, Font::plain));
                    g.drawText(meta.getArtist(), lineX(1), Justification::topRight);

                    auto pos = deck.getPosition();
                    auto posStr = String::formatted("%.2d:%.2d.%.3d", (int)pos / 60, (int)pos % 60, (int)(pos * 1000) % 1000);
                    g.drawText(posStr, lineX(2), Justification::topRight);

                    auto volStr = String::formatted("Vol: %d%%", (int)(deck.getVolume() * 100));
                    g.drawText(volStr, lineX(3), Justification::topRight);

                    g.drawText(deck.isPlaying() ? "Playing" : "Cued", lineX(4), Justification::topRight);

                    if (deck.isMain()) {
                        g.setColour(Colours::orangered);
                        g.drawText("Main", lineX(5), Justification::topRight);
                    }
                }
            }
            else {
                g.setColour(Colours::dimgrey);
                g.setFont(Font("Sarabun", 20, Font::bold));
                g.drawText("<Empty>", getLocalBounds(), Justification::centred);
            }
        }

        void setCover(TagLib::ByteVector& vector) {
            ScopedLock sl(coverImageLock);
            coverImage = ImageFileFormat::loadFrom(vector.data(), vector.size());

            // Resize if too large
            auto size = coverImage.getBounds().toFloat();
            if (size.getWidth() > 800.0f || size.getHeight() > 800.0f) {
                auto h = 800;
                auto w = (int)(size.getAspectRatio() * h);

                auto newImage = Image(Image::PixelFormat::ARGB, w, h, true);
                Graphics g(newImage);

                g.drawImageWithin(coverImage, 0, 0, w, h, RectanglePlacement::centred);

                coverImage = newImage;
            }
        }

        int useTimeSlice() {
            if (auto track = deck.getTrack()) {
                auto trackFile = track->getFile();

                Metadata::CoverAndLyrics cal(trackFile, true, false);
                auto cover = cal.getCover().getData();

                if (!cover.isEmpty()) {
                    setCover(cover);
                }
            }

            return -1;
        }

        Medley& medley;
        medley::Deck& deck;
        medley::Deck& anotherDeck;
        PlayHead playhead;
        TimeSliceThread& thread;
        CriticalSection coverImageLock;
        Image coverImage;
        AudioThumbnail* thumbnail;
        ThumbnailLoader thumbnailLoader;
        ThumbnailCleaner thumbnailCleaner;
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

            gradient.addColour(rangeNormalizer.convertTo0to1(-6.0), Colours::green);
            gradient.addColour(rangeNormalizer.convertTo0to1(-3.0), Colours::yellow);
            gradient.addColour(rangeNormalizer.convertTo0to1(0.0), Colours::red);
        }

        void paint(Graphics& g) override {
            g.setColour(Colours::lightgrey);
            g.fillAll();

            g.setColour(Colours::green);

            auto h = (float)getHeight();
            auto mh = h / 2.0f;

            auto peakLeft = Decibels::gainToDecibels(medley.getPeakLevel(0));
            auto peakRight = Decibels::gainToDecibels(medley.getPeakLevel(1));

            auto levelLeft = Decibels::gainToDecibels(medley.getLevel(0));
            auto levelRight = Decibels::gainToDecibels(medley.getLevel(1));

            g.setGradientFill(gradient);
            g.fillRect(0.0f, 0.0f, (float)(getWidth() * rangeNormalizer.convertTo0to1(jmin(levelLeft, 6.0))), mh);
            g.fillRect(0.0f, mh, (float)(getWidth() * rangeNormalizer.convertTo0to1(jmin(levelRight, 6.0))), mh);

            auto getPeakColour = [=](double db) {
                 if (db > -3.0) return Colours::red;
                if (db > -6.0) return Colours::yellow;
                return Colours::white;
            };

            auto peakLeftX = (int)(getWidth() * rangeNormalizer.convertTo0to1(jmin(peakLeft, 6.0)));
            auto peakRightX = (int)(getWidth() * rangeNormalizer.convertTo0to1(jmin(peakRight, 6.0)));

            g.setColour(getPeakColour(peakLeft));
            g.fillRect((float)peakLeftX - 2.0f, 0.0f, 2.0f, mh);

            g.setColour(getPeakColour(peakRight));
            g.fillRect((float)peakRightX - 2.0f, mh, 2.0f, h);

            auto reduction = 1.0f - (float)rangeNormalizer.convertTo0to1((double)medley.getReduction() + 6.0);
            auto reductionWidth = (float)getWidth() * reduction;
            g.setColour(Colours::darkslateblue);
            g.fillRect((float)getWidth() - reductionWidth, 0.0f, reductionWidth, h);

            g.setFont(mh / 1.8f);
            g.setColour(getPeakColour(peakLeft).darker(0.8f));
            g.drawText(String::formatted("%.2f", peakLeft), peakLeftX + 4, 0, 100, (int)mh, false);
            g.setColour(getPeakColour(peakRight).darker(0.8f));
            g.drawText(String::formatted("%.2f", peakRight), peakRightX + 4, (int)mh, 100, (int)mh, false);
        }

    private:
        Medley& medley;
        ColourGradient gradient;

        NormalisableRange<double> rangeNormalizer{ -100, 6, 0, 1 };
    };

    class QueueModel;
    class QueueListBox;

    class QueueItem : public Component, public DragAndDropTarget {
    public:
        QueueItem(QueueModel& model, QueueListBox& listbox)
            : model(model), listbox(listbox)
        {

        }

        void paint(Graphics& g) override {
            if (selected) {
                g.fillAll(Colours::lightblue);
                g.setColour(Colours::darkblue);
            }
            else {
                g.setColour(LookAndFeel::getDefaultLookAndFeel().findColour(Label::textColourId));
            }


            if (track != nullptr) {
                g.drawText(track->getFile().getFullPathName(), 0, 0, getWidth(), getHeight(), Justification::centredLeft, true);
            }

            if (dragging) {
                g.setColour(Colours::lightyellow);
                g.fillRect(0, 0, getWidth(), 2);
            }
        }

        void update(Track::Ptr track, int rowNumber, bool rowSelected) {
            this->track = track;
            this->rowNumber = rowNumber;
            this->selected = rowSelected;
            repaint();
        }

        bool isInterestedInDragSource(const SourceDetails& dragSourceDetails) override {
            return dragSourceDetails.description.equals("QueueItem");
        }

        void itemDragEnter(const SourceDetails& dragSourceDetails) {
            itemDragMove(dragSourceDetails);
        }

        void itemDragMove(const SourceDetails& dragSourceDetails)
        {
            dragging = true;
            repaint();
        }

        void itemDragExit(const SourceDetails&) {
            setMouseCursor(MouseCursor::NormalCursor);
            dragging = false;
            repaint();
        }

        void itemDropped(const SourceDetails& dragSourceDetails) override {
            if (auto src = dynamic_cast<QueueItem*>(dragSourceDetails.sourceComponent.get())) {
                model.move(src->track, track);
            }

            itemDragExit(dragSourceDetails);
        }

        void mouseDown(const MouseEvent&) override {
            listbox.selectRow(rowNumber);
        }

        void mouseUp(const MouseEvent& e) {
            if (e.mods.isPopupMenu() && listbox.getNumSelectedRows() > 0) {
                juce::Rectangle<int> r(e.getMouseDownScreenX(), e.getMouseDownScreenY(), 0, 0);

                switch (listbox.showMenu(r)) {
                case QueueListBox::kMenu_PlayNext:
                    model.moveToTop(track);
                    break;

                case QueueListBox::kMenu_Delete:
                    model.remove(track);
                    break;

                case QueueListBox::kMenu_Clear:
                    model.clear();
                }
            }
        }

        void mouseDrag(const MouseEvent&) override {
            if (DragAndDropContainer* container = DragAndDropContainer::findParentDragContainerFor(this))
            {
                container->startDragging("QueueItem", this);

                setMouseCursor(MouseCursor::DraggingHandCursor);
            }
        }

        void mouseExit(const MouseEvent&) {
            setMouseCursor(MouseCursor::NormalCursor);
        }


    private:
        QueueModel& model;
        QueueListBox& listbox;

        Track::Ptr track = nullptr;
        int rowNumber = 0;
        bool selected = false;

        bool dragging = false;
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

        }

        Component* refreshComponentForRow(int rowNumber, bool rowSelected, Component* existingComponentToUpdate) {
            if (existingComponentToUpdate == nullptr)
                existingComponentToUpdate = new QueueItem(*this, *listbox);

            Track::Ptr track = nullptr;

            if (rowNumber < (int)queue.tracks.size()) {
                auto at = std::next(queue.tracks.begin(), rowNumber);
                if (at != queue.tracks.end()) {
                    track = at->get();
                }
            }

            static_cast<QueueItem*>(existingComponentToUpdate)->update(track, rowNumber, rowSelected);

            return existingComponentToUpdate;
        }

        void move(Track::Ptr from, Track::Ptr to) {
            auto b = queue.tracks.begin();
            auto e = queue.tracks.end();

            auto src_it = std::find(b, e, from);
            auto dst_it = std::find(b, e, to);

            if (dst_it != e && src_it != e) {
                auto src_index = std::distance(b, src_it);
                auto dst_index = std::distance(b, dst_it);

                queue.tracks.splice(dst_it, queue.tracks, src_it);
                listbox->selectRow(src_index <= dst_index ? dst_index - 1 : dst_index);
                listbox->updateContent();
            }
        }

        void moveToTop(Track::Ptr track) {
            auto b = queue.tracks.begin();
            auto e = queue.tracks.end();

            auto src_it = std::find(b, e, track);

            if (src_it != e) {
                queue.tracks.splice(b, queue.tracks, src_it);

                listbox->selectRow(0);
                listbox->updateContent();
            }
        }

        void remove(Track::Ptr track) {
            auto b = queue.tracks.begin();
            auto e = queue.tracks.end();

            auto src_it = std::find(b, e, track);
            if (src_it != e) {
                queue.tracks.erase(src_it);
                listbox->deselectAllRows();
                listbox->updateContent();
            }
        }

        void clear() {
            queue.tracks.clear();
            listbox->deselectAllRows();
            listbox->updateContent();
        }

        Queue& getQueue() { return queue; }

        QueueListBox* listbox = nullptr;

    private:
        Queue& queue;
    };

    class QueueListBox : public ListBox {
    public:
        QueueListBox(QueueModel& model)
            : ListBox({}, &model)
        {
            menu.addItem(kMenu_PlayNext, "Play Next");
            menu.addSeparator();
            menu.addColouredItem(kMenu_Delete, "Delete", Colours::indianred);
            menu.addColouredItem(kMenu_Clear, "Clear", Colours::indianred);
        }

        int showMenu(const juce::Rectangle<int> r) {
            return menu.showAt(r);
        }

        static const int kMenu_PlayNext = 1;
        static const int kMenu_Delete = 2;
        static const int kMenu_Clear = 3;
    private:

        PopupMenu menu;
    };

    class MainContentComponent
        : public Component,
        public DragAndDropContainer,
        public Timer,
        public Button::Listener,
        public Slider::Listener,
        public medley::Medley::Callback,
        public PlayHead::Callback {
    public:
        MainContentComponent() :
            Component(),
            model(queue),
            medley(queue),
            queueListBox(model),
            btnShuffle("Shuffle"),
            btnAdd("Add"),
            btnPlay("Play"),
            btnStop("Stop"),
            btnPause("Pause"),
            btnFadeOut("Fade Out"),
            volumeText({}, "Volume:"),
            backgroundThread("Cover art thread")
        {
            openGLContext.attachTo(*getTopLevelComponent());

            model.listbox = &queueListBox;

            medley.addListener(this);

            thumbnails[&medley.getDeck1()] = std::make_unique<AudioThumbnail>(1024, medley.getAudioFormatManager(), thumbnailCache);
            thumbnails[&medley.getDeck2()] = std::make_unique<AudioThumbnail>(1024, medley.getAudioFormatManager(), thumbnailCache);
            thumbnails[&medley.getDeck3()] = std::make_unique<AudioThumbnail>(1024, medley.getAudioFormatManager(), thumbnailCache);

            deckA = new DeckComponent(medley, medley.getDeck1(), medley.getDeck2(), backgroundThread, thumbnails[&medley.getDeck1()].get());
            addAndMakeVisible(deckA);

            deckB = new DeckComponent(medley, medley.getDeck2(), medley.getDeck3(), backgroundThread, thumbnails[&medley.getDeck2()].get());
            addAndMakeVisible(deckB);

            deckC = new DeckComponent(medley, medley.getDeck3(), medley.getDeck1(), backgroundThread, thumbnails[&medley.getDeck3()].get());
            addAndMakeVisible(deckC);

            btnShuffle.addListener(this);
            addAndMakeVisible(btnShuffle);

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
            volumeSlider.setValue(medley.getVolume());
            volumeSlider.addListener(this);

            playhead = new PlayHead(*this, backgroundThread);
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
            }

            vuMeter = new VUMeter(medley);
            addAndMakeVisible(vuMeter);

            queueListBox.setColour(ListBox::outlineColourId, Colours::grey);
            addAndMakeVisible(queueListBox);

            setSize(800, 600);

            startTimerHz(60);

            backgroundThread.startThread();
        }

        int lastQueueCount = 0;

        void timerCallback() override {
            deckA->repaint();
            deckB->repaint();
            deckC->repaint();
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
            auto queueHeight = jmax(b.getHeight() * 0.45, 300.0);
            {
                auto devicePanelArea = b.removeFromTop(34).reduced(10, 2);
                comboDeviceTypes.setBounds(devicePanelArea.removeFromLeft(250));
                comboDeviceNames.setBounds(devicePanelArea.removeFromLeft(250).translated(4, 0));
            }

            {
                vuMeter->setBounds(b.removeFromTop(50).reduced(10, 2));
            }

            {
                queueListBox.setBounds(b.removeFromBottom((int)queueHeight).reduced(10));
            }

            {
                auto controlArea = b.removeFromBottom(32).translated(0, 4).reduced(10, 4);
                btnShuffle.setBounds(controlArea.removeFromLeft(55));
                btnAdd.setBounds(controlArea.removeFromLeft(55));
                btnPlay.setBounds(controlArea.removeFromLeft(55));
                btnStop.setBounds(controlArea.removeFromLeft(55));
                btnPause.setBounds(controlArea.removeFromLeft(75));
                btnFadeOut.setBounds(controlArea.removeFromLeft(60));
                volumeText.setBounds(controlArea.removeFromLeft(60));
                volumeSlider.setBounds(controlArea.reduced(4, 0));
            }

            {
                playhead->setBounds(b.removeFromBottom(50).translated(0, 4).reduced(10, 4));
            }

            {
                auto deckPanelArea = b.reduced(20, 2).translated(-10, 0);
                auto w = deckPanelArea.getWidth() / 3;
                deckA->setBounds(deckPanelArea.removeFromLeft(w));
                deckB->setBounds(deckPanelArea.translated(10, 0).removeFromLeft(w));
                deckC->setBounds(deckPanelArea.translated(20 + w, 0).removeFromLeft(w));
            }
        }

        void paint(Graphics& g) override {
            g.fillAll(findColour(ResizableWindow::backgroundColourId));
        }

        ~MainContentComponent() {
            medley.removeListener(this);

            backgroundThread.removeAllClients();

            removeChildComponent(deckA);
            removeChildComponent(deckB);
            removeChildComponent(deckC);
            removeChildComponent(playhead);
            removeChildComponent(vuMeter);

            delete deckA;
            delete deckB;
            delete deckC;
            delete playhead;
            delete vuMeter;
        }

        void getDecks(Deck** pDeck, Deck** pAnotherDeck) {
            *pDeck = medley.getMainDeck();
            *pAnotherDeck = medley.getNextDeck(nullptr);
        }

        AudioThumbnail* getThumbnail(Deck* deck) {
            return deck->isTrackLoaded() ? thumbnails[deck].get() : nullptr;
        }

        void playHeadSeek(double progress) override {
            medley.setPositionFractional(progress);
        }

        void buttonClicked(Button* source) override {
            if (source == &btnShuffle) {
                std::random_device rd;
                std::mt19937 g(rd());

                std::vector<std::reference_wrapper<const Track::Ptr>> v(queue.tracks.cbegin(), queue.tracks.cend());
                std::shuffle(v.begin(), v.end(), g);

                std::list<Track::Ptr> shuffled;
                for (auto& ref : v) shuffled.push_back(ref.get());
                queue.tracks.swap(shuffled);

                queueListBox.updateContent();
                queueListBox.repaint();
                return;
            }

            if (source == &btnAdd) {
                FileChooser fc("Add");

                if (fc.browseForMultipleFilesToOpen()) {
                    auto files = fc.getResults();

                    for (auto f : files) {
                        queue.tracks.push_back(new Track(f));
                    }

                    queueListBox.updateContent();
                    queueListBox.repaint();
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
                medley.togglePause(false);
                updatePauseButton();
                return;
            }

            if (source == &btnFadeOut) {
                medley.fadeOutMainDeck();
            }
        }

        void sliderValueChanged(Slider* slider) override {
            if (slider == &volumeSlider) {
                medley.setVolume((float)slider->getValue());
            }
        }

        void deckTrackScanning(Deck& sender) override {

        }

        void deckTrackScanned(Deck& sender) override {

        }

        void deckPosition(Deck& sender, double position) override {

        }

        void deckStarted(Deck& sender, TrackPlay& track) override {

        }

        void deckFinished(Deck& sender, TrackPlay& track) override {

        }

        void audioDeviceChanged() override {
            updateDeviceType();
            updateDevice();
        }

        void enqueueNext(EnqueueNextDone done) override {
            done(true);
        }

        void mainDeckChanged(Deck& sender, TrackPlay& track) override {

        }

        void updatePauseButton() {
            btnPause.setButtonText(medley.isPaused() ? "Paused" : "Pause");
        }

        void updatePlayButton() {
            btnPlay.setColour(TextButton::buttonColourId, medley.isDeckPlaying() ? Colours::lightgreen : getLookAndFeel().findColour(TextButton::buttonColourId));
            updatePauseButton();
        }

        void deckLoaded(Deck& sender, TrackPlay& track) override {

        }

        void deckUnloaded(Deck& sender, TrackPlay& track) override {

        }

        OpenGLContext openGLContext;

        TextButton btnShuffle;
        TextButton btnAdd;
        TextButton btnPlay;
        TextButton btnStop;
        TextButton btnPause;
        TextButton btnFadeOut;

        Label volumeText;
        Slider volumeSlider;

        QueueListBox queueListBox;

        PlayHead* playhead = nullptr;

        DeckComponent* deckA = nullptr;
        DeckComponent* deckB = nullptr;
        DeckComponent* deckC = nullptr;

        ComboBox comboDeviceTypes;
        ComboBox comboDeviceNames;

        VUMeter* vuMeter = nullptr;

        TimeSliceThread backgroundThread;

        AudioThumbnailCache thumbnailCache{ 3 };
        std::map<Deck*, std::unique_ptr<AudioThumbnail>> thumbnails;

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
            setBounds(100, 50, 800, 830);
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
    juce::JUCEApplicationBase::createInstance = &createApplication;
    return juce::JUCEApplicationBase::main();

    static_cast<void>(getchar());
}
