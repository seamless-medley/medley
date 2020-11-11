#include <iostream>
#include <JuceHeader.h>
#include <Windows.h>

#include "Medley.h"

using namespace juce;

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

class MedlayApp : public JUCEApplication {
public:
    void initialise(const String& commandLine) override
    {
        myMainWindow.reset(new MainWindow());
        myMainWindow->setBounds(100, 100, 400, 500);
        myMainWindow->setVisible(true);
    }

    void shutdown() override {
        myMainWindow = nullptr;
    }

    const juce::String getApplicationName() override { return "BlockFinder"; }

    const juce::String getApplicationVersion() override { return "1.0.0"; }

private:
    class MainContentComponent : public Component, public Button::Listener {
    public:
        MainContentComponent() :
            Component(),
            medley(queue),
            btnOpen("Add")
        {
            btnOpen.setBounds(10, 10, 55, 24);
            btnOpen.addListener(this);

            addAndMakeVisible(btnOpen);
            setSize(600, 400);            
        }

        void buttonClicked(Button*) override {
            FileChooser fc("test");

            if (fc.browseForMultipleFilesToOpen()) {
                auto files = fc.getResults();

                for (auto f : files) {
                    queue.tracks.push_back(new Track(f));
                }

                medley.play();
            }
        }


        TextButton btnOpen;

        Queue queue;
        medley::Medley medley;
    };

    class MainWindow : public DocumentWindow {
    public:
        explicit MainWindow()
            : DocumentWindow("Medley", Colours::white, DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);
            setContentOwned(new MainContentComponent(), true);
            setBounds(100, 50, getWidth(), getHeight());
            setResizable(true, false);
            setVisible(true);
        }

        void closeButtonPressed() override
        {
            JUCEApplication::getInstance()->systemRequestedQuit();
        }        
    };

    std::unique_ptr<MainWindow> myMainWindow;
};

juce::JUCEApplicationBase* createApplication() {
    return new MedlayApp();
}

int main()
{
    static_cast<void>(::CoInitialize(nullptr));

    juce::JUCEApplicationBase::createInstance = &createApplication;
    return juce::JUCEApplicationBase::main();    

    /*OPENFILENAMEW of{};
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
    }*/

    //medley::Medley medley(queue);
    //medley.play();

    static_cast<void>(getchar());
}
