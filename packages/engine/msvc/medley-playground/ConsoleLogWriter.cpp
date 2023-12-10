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

void ConsoleLogWriter::log(medley::LogLevel level, std::string& name, std::string& msg) const {
    std::cout << std::setw(5) << levels[(int8_t)level + 1];
    std::string line = " [" + name + "] " + msg;
    std::cout << line << std::endl;
}
