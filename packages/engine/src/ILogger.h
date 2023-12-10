#pragma once

#include <JuceHeader.h>

namespace medley {

enum class LogLevel : int8_t {
    Trace = -1,
    Debug,
    Info,
    Warn,
    Error,
    Fatal
};

class ILoggerWriter {
public:
    ILoggerWriter()
    {

    }

    virtual void log(medley::LogLevel level, juce::String& name, juce::String& msg) const = 0;

    inline void trace(juce::String& name, juce::String& msg) const {
        log(LogLevel::Trace, name, msg);
    }

    inline void debug(juce::String& name, juce::String& msg) const {
        log(LogLevel::Debug, name, msg);
    }

    inline void info(juce::String& name, juce::String& msg) const {
        log(LogLevel::Info, name, msg);
    }

    inline void warn(juce::String& name, juce::String& msg) const {
        log(LogLevel::Warn, name, msg);
    }

    inline void error(juce::String& name, juce::String& msg) const {
        log(LogLevel::Error, name, msg);
    }

    inline void fatal(juce::String& name, juce::String& msg) const {
        log(LogLevel::Fatal, name, msg);
    }
};

class Logger {
public:
    Logger(juce::String name, ILoggerWriter* writer)
        : name(name), impl(writer)
    {

    }

    void log(medley::LogLevel level, juce::String msg) {
        if (impl) {
            impl->log(level, name, msg);
        }
    }

    void trace(juce::String msg) {
        if (impl) {
            impl->trace(name, msg);
        }
    }

    void debug(juce::String msg) {
        if (impl) {
            impl->debug(name, msg);
        }
    }

    void info(juce::String msg) {
        if (impl) {
            impl->info(name, msg);
        }
    }

    void warn(juce::String msg) {
        if (impl) {
            impl->warn(name, msg);
        }
    }

    void error(juce::String msg) {
        if (impl) {
            impl->error(name, msg);
        }
    }

    void fatal(juce::String msg) {
        if (impl) {
            impl->fatal(name, msg);
        }
    }

private:
    juce::String name;
    ILoggerWriter* impl;
};

}
