#include "ConsoleLogWriter.h"

using namespace medley;

static const char* levels[] = {
    "TRACE",
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR",
    "FATAL"
};

void ConsoleLogWriter::log(medley::LogLevel level, juce::String& name, juce::String& msg) const {
    std::cout << std::setw(5) << levels[(int8_t)level + 1];
    juce::String line = " [" + name + "] " + msg;
    std::cout << line << std::endl;
}
