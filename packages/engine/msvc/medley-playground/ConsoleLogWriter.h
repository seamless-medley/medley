#pragma once

#include "Medley.h"

class ConsoleLogWriter : public medley::ILoggerWriter {
public:
    void log(medley::LogLevel level, std::string& name, std::string& msg) const override;

};
