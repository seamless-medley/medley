# node-medley

`node-medley` is a Node.js native module built on top of [JUCE](https://github.com/juce-framework/JUCE) framework to provide audio playback to either an audio output device or [Node.js stream](https://nodejs.org/api/stream.html)

# Table of contents
- [Features](#features)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Supported File Formats](#supported-file-formats)
- TODO: Guide
    - Getting available audio device
    - Selecting audio device
    - Null Audio device
    - Getting PCM stream
    - Getting metadata
    - Getting cover art and lyrics
    - Getting audio level information
    - Check if track is loadable
    - Custom transition point
- [API](#api)

# Features
- Cross-platform
- Seamless playback
- Nice transition between tracks, with customizable transition point
- Track metadata reading, including cover art and lyrics
- ReplayGain support
- Audio level normalization (in conjunction with ReplayGain)
- Built-in audio limiter
- Audio level measurement
- Play directly to audio device
- Consume PCM data directly from audio pipeline via Node.js stream

# Installation

### With `npm`:
```sh
npm i @seamless-medley/medley
```

### With `pnpm`:
```sh
pnpm add @seamless-medley/medley
```
# Getting started

```ts
// Import 2 main classes.
import { Medley, Queue } from '@seamless-medley/medley';

// Then craete a new queue instance and pass it to `Medley` class while instantiate.
const queue = new Queue();
const medley = new Medley(queue);

// Add some tracks to the `queue` and start playing
queue.add('/path/to/file');
queue.add('/path/to/file2');
medley.play();
```
> This will start playing to the default audio device.

# Supported File Formats
Currently, the supported file formats are limited to: `wav`, `aiff`, `mp3`, `ogg` and `flac`, but more formats might be added in the future.

# API

- [Medley](#medley-class)
    - [play](#playshouldfade--true)
    - [stop](#stopshouldfade--true)
    - [togglePause](#togglepauseshouldfade--true)
    - [fadeOut](#fadeout)
    - [seek](#seektime-deckindex)
    - [seekFractional](#seekfractionalfraction-deckindex)
    - [getDeckPositions](#getdeckpositionsdeckindex)
    - [getDeckMetadata](#getdeckmetadatadeckindex)
    - [getAvailableDevices](#getavailabledevices)
    - [getAudioDevice](#getaudiodevice)
    - [setAudioDevice](#setaudiodevicedescriptor)
    - [playing](#playing)
    - [paused](#paused)
    - [volume](#volume)
    - [fadingCurve](#fadingcurve)
    - [maximumFadeOutDuration](#maximumfadeoutduration)
    - [minimumLeadingToFade](#minimumleadingtofade)
    - [replayGainBoost](#replaygainboost)
    - [level](#level)
- [Queue](#queue-class)
    - [add](#addtrack)
    - [insert](#insertindex-track)
    - [delete](#deleteindex-count--1)
    - [swap](#swapindex1-index2)
    - [move](#movecurrentindex-newindex)
    - [get](#getindex)
    - [set](#setindex-track)
    - [toArray](#toarray)
    - [length](#length-property)

## `Medley` class

This is the main class, the constructor accepts an instance of [Queue](#queue-class) class.

```ts
new Medley(queue)
```

> **NOTE**: JavaScript `Array` cannot be used as a queue.

**Methods**
### `play(shouldFade = true)`

Start playing, if the playing was previously paused it will be resumed.

The `shouldFade` parameter will be used only when resuming.

### `stop(shouldFade = true)`

Stop playing.

### `togglePause(shouldFade = true)`

Toggle play/pause.

### `fadeOut()`

Forcefully transit to the next track with fade-out effect.

## `seek(time, deckIndex?)`

- `time` is in seconds
- `deckIndex` optional deck index, possible values are: `0`, `1`, `2`

## `seekFractional(fraction, deckIndex?)`
- `fraction` Fraction of track's length.
    - `0` - Seek to the beginning.
    - `0.5` Seek to the middle of a track.

- `deckIndex` optional deck index, possible values are: `0`, `1`, `2`

## `getDeckPositions(deckIndex)`

- `deckIndex` optional deck index, possible values are: `0`, `1`, `2`

Returns an `object` with:

- `current` *(number)* - Current playing position, in seconds
- `duration` *(number)* - Total duration, in seconds
- `first` *(number)* - First audible position, in seconds
- `last` *(number)* - First audible position, in seconds

## `getDeckMetadata(deckIndex)`

- `deckIndex` optional deck index, possible values are: `0`, `1`, `2`

Returns [Metadata](#metadata) for the specified `deckIndex`

## `getAvailableDevices()`

Returns `array` of `object` describing an audio device type.

- `type` *(string)* - Device type
- `isCurrent` *(boolean)* - `true` if this device type is currently selected
- `devices` *(string[])* - List of devices of this type
- `defaultDevice` *(string)* - Default device name of this type
- `currentDevice` *(string | undefined)* - Currently selected device name of this type, `undefined` if none

## `getAudioDevice()`

Get audio device currently being selected, returns `undefined` if none.

If available, returns an `object` with:

- `type` *(string)* - Device type
- `device` *(string)* - Device name

## `setAudioDevice(descriptor)`

Set audio device used for playback.

The `descriptor` is an `object` containing:

- `type` *(string?)* - Device type, if omitted, the currently selected device type is used
- `device` *(string?)* - Device name, if omitted, the default

> If both fields are omitted, this method does nothing.

Returns `false` if the specified device cannot be used.

Returns `true` if some device is selected.

> Use [getAudioDevice()](#getaudiodevice) to get the actual selected device.

# TODO: requestAudioStream, requestAudioCallback, updateAudioStream, deleteAudioStream

**Properties**

## playing

Type: `boolean`

**Read only**

Returns `true` if is playing, but not affected by the `paused` property.

## paused

Type: `boolean`

**Read only**

Returns `true` if is playing but has been paused.

## volume

Type: `number`

Audio volume in linear scale.

`0` = Silent

`1` = 0dBFS

## fadingCurve

Type: `number`

Minimum: `0`

Maximum: `100`

S-Curve value used for fading in/out.

## maximumFadeOutDuration

Type: `number`

The maximum duration in seconds for the fade-out transition between tracks.

## minimumLeadingToFade

Type: `number`

The duration in seconds at the beginning of a track to be considered as having a long intro.

A track with a long intro will cause a fading-in to occur during transition.

## replayGainBoost

Type: `number`

Default: `9.0`

Gain (in dB) to boost for tracks having ReplayGain metadata embeded, default to 9.0dB.

If a track has no ReplayGain metadata, this value is ignored.

## level

**Read only**

Returns an `object` with:

- `left` - Left channel level
- `right` - Right channel level

With each channel having:

- `magnitude` **(number)** - Audio level

- `peak` **(number)** - Holding peak

## reduction

**Read only**

Returns audio reduction level in dB

Audio reduction occur during the internal audio processing

# TODO: Events

# TODO: Static methods

## `Queue` class

The queue class provides tracks list to the [Medley](#medley-class) class.

**Constructor**

### `new Queue(tracks?)`

Create a new instance of the `Queue` class, an optional `tracks` is an array of tracks to initially fill the queue.

The `Queue` class is dead simple, if you need more control over your tracks list, you must manage the list by yourself and provide a track when the `Medley` object requires one, see [Medley enqueueNext event](#)

# TODO: TrackInfo

**Methods**

### `add(track)`
Add a track to the queue.
### `add(tracks)`
Add list of tracks to the queue.

### `insert(index, track)`
### `insert(index, tracks)`

Insert track(s) at position specified by the `index` parameter.

### `delete(index, count = 1)`

Delete tracks(s) specified by `count` starting from `index`.

### `swap(index1, index2)`

Swap track.

### `move(currentIndex, newIndex)`

Move a track to the new location.

### `get(index)`

Get the track at `index`

### `set(index, track)`

Set the track at `index`

### `toArray()`

Returns a new shallow copy of all tracks.

**Properties**

### `length` property

Returns total number of tracks in the queue.

# Metadata
  - `title` *(string?)*
  - `artist` *(string?)*
  - `album` *(string?)*
  - `isrc` *(string?)* - [International Standard Recording Code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code)
  - `albumArtist` *(string?)*
  - `originalArtist` *(string?)*
  - `bitrate` *(number?)* - in **Kbps**
  - `sampleRate` *(number?)* - in **Hz**
  - `duration` *(number?)* - in **second**
  - `trackGain` *(number?)* - [ReplayGain](https://en.wikipedia.org/wiki/ReplayGain) value in **dB (decibels)**, `0` means no `ReplayGain` value for this track
  - `bpm` *(number?)* - Beats Per Minute
  - `comments` *([string, string][])* - List of key/value pair for all user-defined comments

# Demo musics
Demo music from [Bensound.com](https://bensound.com)

