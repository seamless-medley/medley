#pragma once

#include <string>

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
    ILoggerWriter::ILoggerWriter()
    {

    }

    virtual void log(medley::LogLevel level, std::string& name, std::string& msg) const = 0;

    inline void trace(std::string& name, std::string& msg) const {
        log(LogLevel::Trace, name, msg);
    }

    inline void debug(std::string& name, std::string& msg) const {
        log(LogLevel::Debug, name, msg);
    }

    inline void info(std::string& name, std::string& msg) const {
        log(LogLevel::Info, name, msg);
    }

    inline void warn(std::string& name, std::string& msg) const {
        log(LogLevel::Warn, name, msg);
    }

    inline void error(std::string& name, std::string& msg) const {
        log(LogLevel::Error, name, msg);
    }

    inline void fatal(std::string& name, std::string& msg) const {
        log(LogLevel::Fatal, name, msg);
    }
};

class Logger {
public:
    Logger::Logger(std::string& name, ILoggerWriter* writer)
        : name(name), impl(writer)
    {

    }

    void log(medley::LogLevel level, std::string& msg) {
        if (impl) {
            impl->log(level, name, msg);
        }
    }

    void trace(std::string& msg) {
        if (impl) {
            impl->trace(name, msg);
        }
    }

    void debug(std::string& msg) {
        if (impl) {
            impl->debug(name, msg);
        }
    }

    void info(std::string& msg) {
        if (impl) {
            impl->info(name, msg);
        }
    }

    void warn(std::string& msg) {
        if (impl) {
            impl->warn(name, msg);
        }
    }

    void error(std::string& msg) {
        if (impl) {
            impl->error(name, msg);
        }
    }

    void fatal(std::string& msg) {
        if (impl) {
            impl->fatal(name, msg);
        }
    }

private:
    std::string name;
    ILoggerWriter* impl;
};

}
