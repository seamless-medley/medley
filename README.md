# Medley

> [!NOTE]
> Medley is currently in active development. Some features, such as a Web UI for configuration, are not yet implemented.
>
> We appreciate your patience and welcome contributions!

## Overview
Medley is a project that aims to deliver a genuine radio station experience with automatic, seamless playback and mixing capabilities.

Medley brings a radio-like approach to your personal music collection.

It's more than just a playlist - it's a system that creates a continuous, curated listening stream based on your preferences and music moods, with the added bonus of Discord bot functionality for interactive control.

We have a [Discord](https://discord.gg/vrzCvV2hjS) channel where anyone can join.

So you can:

- Interact with the Medley Discord bot
- Listen to the audio stream provided by Medley
- Connect with other Medley users and the development team

You can also run your own Medley instance, please see [Beta Testing Guide](https://github.com/seamless-medley/medley/wiki/Beta-Testing).

## Key Features
- 🔀 Automatic and seamless music playback
  - With customizable mixing behavior through embedded metadata
- 🎨 Artist rotation to ensure variety
  - This prevents the repetition of songs from the same artist too frequently, much like a well-curated radio station.
- 🔊 ReplayGain and DSP audio limiter for consistent sound quality
- 🚀 Multi-platform audio streaming
- 🤖 Interactive Discord bot with slash commands
- 🎵 Spotify Integration for easy track and artist requests
- 🎤 Vocal Removal (Karaoke) for instant instrumental versions

## Medley Discord Bot Screenshots

<img src="https://github.com/user-attachments/assets/ac173d6e-55c7-49d9-b2be-de15e544a2b5" width="300" alt="image" >
<br />
<img src="https://github.com/user-attachments/assets/2554e527-9f45-458b-b31f-1602d67e5091" height="400" />
<img src="https://github.com/user-attachments/assets/4996a4a9-fdb8-46cb-ac04-73a0161f2492" height="400" />
<img src="https://github.com/user-attachments/assets/bf37290a-c1af-4f03-be14-c749f6d2eeed" height="400" />
<img src="https://github.com/user-attachments/assets/9cc7e278-b200-48b8-bad8-6ec25c268fb9" height="400" />

<br />
<img src="https://github.com/user-attachments/assets/cffcba2a-47f3-4aee-9db0-0595b14ebb5f" width="300" />



## Project Motivation

Medley was born out of a personal desire to enhance the music listening experience. My motivations stem from common frustrations and a love for diverse, engaging audio:

- **Avoiding "Music Boredom"**: Playing random songs can lead to jarring mood shifts, while sticking to playlists becomes predictable over time. Medley aims to strike a balance, offering variety without sacrificing cohesion.

- **Replicating Radio Magic**: The project draws inspiration from the curated experience of radio stations, where songs flow seamlessly from one to another, maintaining a consistent vibe.

- **Unpredictability with Purpose**: Medley seeks to recreate the excitement of not knowing what song comes next, while ensuring that each transition makes sense musically and emotionally.

- **Enhancing Interaction**: While traditional radio offers limited listener interaction, Medley incorporates features like Discord integration to allow users to engage with the audio stream, request songs, and customize their experience.

## Supported File Formats

- MP3
- FLAC
- WAV
- OGG

## Powered by [node-medley](https://github.com/seamless-medley/medley/blob/main/packages/node-medley/README.md)
Medley is powered by the `node-medley` project, which serves as the engine behind all of its audio capabilities.

For detailed information about `node-medley`, please refer to its [README](https://github.com/seamless-medley/medley/blob/main/packages/node-medley/README.md)

## [ReplayGain](https://en.wikipedia.org/wiki/ReplayGain) and Audio Limiter
Medley supports ReplayGain to ensure a consistent listening experience.

- Prevents sudden volume changes between tracks, eliminating the need for manual volume adjustments
- Maintains a comfortable listening level across different songs
- Prevents audio clipping and distortion

## Customizable Seamless Mixing
Medley offers a feature that allows customization of the automatic mixing behavior for each track. This is achieved through embedded metadata in the media files:

This feature provides granular control over how the tracks blend together.

## Audio Output Targets
Medley can send its audio output to the following targets:
- Discord
- Icecast
- ... and more to come

## Running your own station
We welcome beta testers to try out the current version and provide valuable feedback.

For instructions on how to set up and test Medley, please refer to our [Beta Testing Guide](https://github.com/seamless-medley/medley/wiki/Beta-Testing).

## Spotify Integration
See: [Beta Testing Guide](https://github.com/seamless-medley/medley/wiki/Beta-Testing#spotify-integration)

## Contributors

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-3-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/vittee"><img src="https://avatars.githubusercontent.com/u/403872?v=4?s=100" width="100px;" alt="Wittawas Nakkasem"/><br /><sub><b>Wittawas Nakkasem</b></sub></a><br /><a href="https://github.com/seamless-medley/medley/commits?author=vittee" title="Code">💻</a> <a href="#ideas-vittee" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-vittee" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#platform-vittee" title="Packaging/porting to new platform">📦</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/visualizeq"><img src="https://avatars.githubusercontent.com/u/396689?v=4?s=100" width="100px;" alt="Coke"/><br /><sub><b>Coke</b></sub></a><br /><a href="https://github.com/seamless-medley/medley/commits?author=visualizeq" title="Code">💻</a> <a href="#ideas-visualizeq" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-visualizeq" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#platform-visualizeq" title="Packaging/porting to new platform">📦</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/priesdelly"><img src="https://avatars.githubusercontent.com/u/304075?v=4?s=100" width="100px;" alt="Priesdelly"/><br /><sub><b>Priesdelly</b></sub></a><br /><a href="https://github.com/seamless-medley/medley/commits?author=priesdelly" title="Code">💻</a> <a href="#ideas-priesdelly" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-priesdelly" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#platform-priesdelly" title="Packaging/porting to new platform">📦</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
