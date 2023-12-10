#pragma once

#include "Medley.h"

class ConsoleLogWriter : public medley::ILoggerWriter {
public:
    void log(medley::LogLevel level, juce::String& name, juce::String& msg) const override;

};
