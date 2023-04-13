# node-medley

`node-medley` is a Node.js native module built on top of [JUCE](https://github.com/juce-framework/JUCE) framework to provide audio playback to either an audio output device or [Node.js stream](https://nodejs.org/api/stream.html)

# Table of contents
- [Features](#features)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Supported File Formats](#supported-file-formats)
- [Guide](#guide)
    - [Getting available audio devices](#getting-available-audio-devices)
    - [Selecting audio device](#selecting-audio-device)
    - [Null Audio device](#null-audio-device)
    - [Getting PCM data](#getting-pcm-data)
    - [Dynamic queue](#dynamic-queue)
    - [Check if a track is loadable](#check-if-a-track-is-loadable)
    - [Getting metadata](#getting-metadata)
    - [Getting cover art and lyrics](#getting-cover-art-and-lyrics)
    - [Reading audio level information](#reading-audio-level-information)
    - [Normalizing tracks audio level](#normalizing-tracks-audio-level)
    - [Custom transition point](#custom-transition-point)
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

# Guide

## Getting available audio devices

Just use [getAvailableDevices](#getavailabledevices) method.

## Selecting audio device

Use data returned from [getAvailableDevices](#getavailabledevices) method with [setAudioDevice](#setaudiodevicedescriptor) method

*Example:*
```js
// Use default device of the first type

const allDevices = medley.getAvailableDevices();
medley.setAudioDevice({
    type: allDevices[0].type,
    device: allDevices[0].defaultDevice
});

```

## Null Audio device

`node-medley` has a special audio device called `Null Device` which does not play sound to the actual audio device.

This is useful when `node-medley` is being used in an environment without any audio devices installed.

Or you simply because you just need to consume the PCM audio data without sending it to the actual audio device. see [requestAudioStream](#requestaudiostreamoptions) method.

*Example:*
```js
medley.setAudioDevice({ type: 'Null', device: 'Null Device' });
```

## Getting PCM data

```js
// Request for signed 16 bit, little endian, 48000 sample rate audio stream
const result = await medley.requestAudioStream({
    format: 'Int16LE',
    sampleRate: 48000
});

// Pipe to another stream
result.stream.pipe(/* destination */);

// Or intercept data with `on` event
result.stream.on('data', (buffer) => {
    // Do something with `buffer`
});

// When done, don't forget the delete the stream
medley.deleteAudioStream(result.id);
```

## Dynamic queue

Sometimes adding tracks to the queue upfront can cause [Musical Boredom](https://google.com/search?q=musical%20boredom), so let's make the queue dynamic by leveraging [enqueueNext event](#enqueuenextdone)

*Example:*
```js
medley.on('enqueueNext', (done) => {
    const newTrack = getNewFreshTrack(); // Your logic goes here
    queue.add(newTrack);
    done(true);
});
```

## Check if a track is loadable

Use [isTrackLoadable](#istrackloadabletrack) static method.

## Getting metadata

There are two ways of getting metada:

1. From file path
    - Use [getMetadata](#getmetadatapath) static method
2. From a deck
    - Use [getDeckMetadata](#getdeckmetadatadeckindex) method

## Getting cover art and lyrics

Use [getCoverAndLyrics](#getcoverandlyricspath) method.

## Reading audio level information

Real-time audio level information can be retrieved by using [level](#level) property.

*Example:*
```js
// Reading audio level at 30 times per second rate
setInterval(() => {
    const audioLevel = medley.level;
    // Use the returned value
}, 1000 / 30);

```

## Normalizing tracks audio level

[ReplayGain](https://en.wikipedia.org/wiki/ReplayGain) can be use to analyze for the adjustment to the perceived loudness of audio tracks.

`node-medley` supports reading ReplayGain `Track-gain` metadata embeded in audio files.

To embed it, you can use one of these [scanners](https://en.wikipedia.org/wiki/ReplayGain#Scanners).

Usually, ReplayGain attenuates the played back audio, a `make-up` gain should be applied to boost the audio level back to the normalized level, you can change this `make-up` gain by changing the [replayGainBoost](#replaygainboost) property.

The `make-up` gain will not cause clipping, because there is an audio limiter preventing that from happening in the audio pipline.

## Custom transition point

`node-medley` automatically analyze tracks to find audio positions in which it should start/stop playing and also the positions/durations the transition between track should occur.

but, sometimes this may not be as intended, you can customize that by giving `node-medley` some hints.

The hints can come from the metadata embed in the track itself using user-defined tag, here are the supported tags:

- `CUE-IN` or `CUE_IN` - Start position of the track, in seconds
    > This correspond to the [TrackInfo](#trackinfo) `cueInPosition` property.

- `CUE-OUT` or `CUE_OUT` - Stop position of the track, in seconds
    > This correspond to the [TrackInfo](#trackinfo) `cueOutPosition` property.

Alternatively, you can provide that values when adding a track into the queue.

See also:
- [TrackInfo](#trackinfo)
- [Queue::add](#addtrack)

# API

- [Medley](#medley-class)
    - Methods
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
        - [requestAudioStream](#requestaudiostreamoptions)
        - [updateAudioStream](#updateaudiostreamid-options)
        - [deleteAudioStream](#deleteaudiostreamid)
    - Properties
        - [playing](#playing)
        - [paused](#paused)
        - [volume](#volume)
        - [fadingCurve](#fadingcurve)
        - [maximumFadeOutDuration](#maximumfadeoutduration)
        - [minimumLeadingToFade](#minimumleadingtofade)
        - [replayGainBoost](#replaygainboost)
        - [level](#level)
    - Events
        - [Deck Events](#deck-events)
            - [loaded](#loaded)
            - [unloaded](#unloaded)
            - [started](#started)
            - [finished](#finished)
        - [enqueueNext](#enqueuenextdone)
        - [audioDeviceChanged]()
    - Static methods
        - [getInfo](#getinfo)
        - [isTrackLoadable](#istrackloadabletrack)
        - [getMetadata](#getmetadatapath)
        - [getCoverAndLyrics](#getcoverandlyricspath)

- [Queue](#queue-class)
    - Methods
        - [add](#addtrack)
        - [insert](#insertindex-track)
        - [delete](#deleteindex-count--1)
        - [swap](#swapindex1-index2)
        - [move](#movecurrentindex-newindex)
        - [get](#getindex)
        - [set](#setindex-track)
        - [toArray](#toarray)
    - Properties
        - [length](#length-property)

- [Metadata](#metadata)

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

## `requestAudioStream(options?)`

Request for PCM audio data stream

`options?` is an `object` with:

- `sampleRate` **(number)** - Sample rate for the PCM data, if omitted, the default device's sample rate will be used

- `format` - Audio sample format, possible values are:
    - `Int16LE` - 16 bit signed integer, little endian
    - `Int16BE` - 16 bit signed integer, big endian
    - `FloatLE` - 32 bit floating point, little endian
    - `FloatBE` - 32 bit floating point, big endian

- `bufferSize` **(number)** - Maximun frames the internal buffer can hold, increase this value helps reduce stuttering in some situations
    - Default value is 250ms (`sampleRate` * 0.25)

- `buffering` **(number)**:
    - Number of frames to buffer before returning the buffered frames back to Node.js stream
    - Reducing this value will cause the stream to pump faster
    - Default value is 10ms  (`sampleRate` * 0.01)

- `preFill` **(number)** - Optional number of frames to pre-fill into the stream right after requesting

- `gain` **(number)** - utput gain, a floating point number ranging from 0 to 1

Returns a `Promise` of `object` with:

- `id` **(number)** - The request id, use this value to update or delete the requested stream

- `channels` **(number)** - Number of audio channels, This is usuaully `2`

- `originalSampleRate` **(number)** - Original sample rate in audio pipeline

- `sampleRate` **(number)** - Sample rate as requested

- `bitPerSample` **(number)** - Bit per sample, depending on the `format`
    - `16` - for `Int16LE` of `Int16BE`
    - `32` - for `FloatLE` of `FloatBE`

- `stream` **(Readable)** - Readable stream, use this field to consume PCM data

## `updateAudioStream(id, options)`

Update the requested audio stream specified by `id` returned from [requestAudioStream](#requestaudiostreamoptions) method.

`options` is an `object` with:

- `gain` **(number)** - Output gain, a floating point number ranging from 0 to 1

- `buffering` - See [requestAudioStream](#requestaudiostreamoptions)

Returns `true` if succeeded.

## `deleteAudioStream(id)`

Delete the requested audio stream specified by `id` returned from [requestAudioStream](#requestaudiostreamoptions) method.

**Properties**

## `playing`

Type: `boolean`

**Read only**

Returns `true` if is playing, but not affected by the `paused` property.

## `paused`

Type: `boolean`

**Read only**

Returns `true` if is playing but has been paused.

## `volume`

Type: `number`

Audio volume in linear scale.

`0` = Silent

`1` = 0dBFS

## `fadingCurve`

Type: `number`

Minimum: `0`

Maximum: `100`

S-Curve value used for fading in/out.

## `maximumFadeOutDuration`

Type: `number`

The maximum duration in seconds for the fade-out transition between tracks.

## `minimumLeadingToFade`

Type: `number`

The duration in seconds at the beginning of a track to be considered as having a long intro.

A track with a long intro will cause a fading-in to occur during transition.

## `replayGainBoost`

Type: `number`

Default: `9.0`

Gain (in dB) to boost for tracks having ReplayGain metadata embeded, default to 9.0dB.

If a track has no ReplayGain metadata, this value is ignored.

## `level`

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

**Events**

## Deck events

*Parameters:*

- `deckIndex` **(number)** - Deck index in which the event occur

- `trackPlay` - An object describing detail of the play session for the Deck.
    - `uuid` **(string)** - A unique string identifying the `trackPlay` itself
    - `track` - Track, see [TrackInfo](#trackinfo)
    - `duration` **(nunber)** - Track duration

## `loaded`

Emits when a track has been loaded into a Deck.

## `loaded`

Emits when a track has been loaded into a Deck.

## `unloaded`

Emits when a track has been unloaded from a Deck.

## `started`

Emits when a Deck has started playing.

## `finished`

Emits when a Deck has finished playing.

## `mainDeckChanged`

Emits when a Deck become the main playing Deck.

## `enqueueNext(done)`

Emits when the playing queue is exhausted and need to be filled.

See [Dynamic quque](#dynamic-queue)

*Parameter:*
- `done` - Call this function in the event handler with `true` value to inform `node-medley` that at least a track has been added to the queue and should be loaded.

## `audioDeviceChanged`

Emits when the audio device has changed, use [getAudioDevice](#getaudiodevice) method to get the audio device.


**Static methods**

## `getInfo`

Returns an `object` containing information about `node-medley`

- `runtime`:
    - `file` - Node native module file name
    - `runtime` - Runtime name
    - `napi` - `node-addon-api` version

- `version` - `node-medley` version number

- `juce` - Detail for the [JUCE](https://github.com/juce-framework/JUCE) framework library being linked into `node-medley`
    - `version`
    - `cpu`
        - `intel` - Intel CPU
        - `arm` - ARM CPU
        - `arm64` - ARM64 CPU
        - `aarch64` - ARM64 CPU
        - `sse` - SIMD supports on x84_64 CPU
        - `neon` - SIMD supports on ARM CPU
        - `vdsp` - [vDSP](https://developer.apple.com/documentation/accelerate/vdsp) supports on macOS

## `isTrackLoadable(track)`

Returns `true` if the `track` can be loaded and played.

## `getMetadata(path)`

Returns [Metadata](#metadata) for `path`

## `getCoverAndLyrics(path)`

Returns an `object` with:

- `cover` **(Buffer)** - Cover art data

- `coverMimeType` **(string)** - Cover art mime type

- `lyrics` **(string)** - Raw lyrics data

## `Queue` class

The queue class provides tracks list to the [Medley](#medley-class) class.

**Constructor**

### `new Queue(tracks?)`

Create a new instance of the `Queue` class, an optional `tracks` is an array of tracks to initially fill the queue.

The `Queue` class is dead simple, if you need more control over your tracks list, you must manage the list by yourself and provide a track when the `Medley` object requires one, see [enqueueNext event](#enqueuenextdone)

**Methods**

### `add(track)`
Add a track to the queue, see [TrackInfo](#trackinfo)
### `add(tracks)`
Add list of tracks to the queue, see [TrackInfo](#trackinfo)

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

# TrackInfo

A `TrackInfo` can be either a `string` to file path, or an `object` with:

- `path` **(string)** - file path

- `cueInPosition` **(number?)** - Start position of the track

- `cueOutPosition` **(number?)** - Stop position of the track

- `disableNextLeadIn` **(boolean?)**
    - Disable lead-in of the next track, useful for transiting from jingle/sweeper
    - The lead-in is the position where it is considered as the start singing point, usually presented in a track which has smooth/long beginning.

# Metadata
  - `title` *(string?)*
  - `artist` *(string?)*
  - `album` *(string?)*
  - `isrc` *(string?)* - [International Standard Recording Code](https://en.wikipedia.org/wiki/International_Standard_Recording_Code)
  - `albumArtist` *(string?)*
  - `originalArtist` *(string?)*
  - `bitrate` *(number?)* - in **Kbps**
  - `sampleRate` *(number?)* - in **Hz**
  - `duration` *(number?)* - in **seconds**
  - `trackGain` *(number?)* - [ReplayGain](https://en.wikipedia.org/wiki/ReplayGain) value in **dB (decibels)**, `0` means no `ReplayGain` value for this track
  - `bpm` *(number?)* - Beats Per Minute
  - `comments` *([string, string][])* - List of key/value pair for all user-defined comments

# Demo musics
Demo music from [Bensound.com](https://bensound.com)

