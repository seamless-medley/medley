#!/usr/bin/env bash

brew install --build-from-source taglib
brew link --overwrite taglib
brew install libsamplerate
brew link --overwrite libsamplerate
