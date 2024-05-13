import { BoomBoxTrack, Crate, MusicCollectionWatch, MusicDb, Station, StationProfile, StationRegistry, StationTrack, WatchPathWithOption, WatchTrackCollection, crateLimitFromSequenceLimit, createChanceable, scanDir } from "@seamless-medley/core";
import { readFile } from 'node:fs/promises';

import {
  type StationConfig,
  type SequenceConfig,
  type StationProfile as StationProfileConfig
} from './config/station';
import { AutomatonConfig } from "./config/automaton";
import { MedleyAutomaton } from "./discord/automaton";
import { join } from "path";
import { isString } from "lodash";

function createCrateFromSequence(id: string, station: Station, sequence: SequenceConfig) {
  const validCollections = sequence.collections.filter(({ id: collectionId }) => station.hasCollection(collectionId));

  if (validCollections.length === 0) {
    return;
  }

  return new Crate({
    id,
    sources: validCollections.map(({ id, weight = 1 }) => ({ collection: station.getCollection(id)!, weight })),
    chance: createChanceable(sequence.chance),
    limit: crateLimitFromSequenceLimit(sequence.limit)
  })
}

function createTrackCollection(id: string, paths: MusicCollectionWatch[] = [], logPrefix: string) {
  const collection = new WatchTrackCollection<BoomBoxTrack>(id, undefined, { logPrefix, scanner: scanDir });

  for (const path of paths) {
    collection.watch(isString(path) ? { dir: path } : path);
  }

  return collection;
}

export function createStationProfile(station: Station, config: StationProfileConfig & { id: string }) {
  const {
    id: profileId,
    name,
    description,
    intros,
    sweeperRules,
    requestSweepers,
    sequences
  } = config;

  const stationId = station.id;

  const crates = sequences
    .map((seq, index) => createCrateFromSequence(`${profileId}/${index}-${seq.collections.map(c => c.id)}`, station, seq))
    .filter((c): c is Crate<StationTrack> => c !== undefined);

  const profile = new StationProfile({
    id: profileId,
    name,
    description,
    crates
  });

  profile.noRequestSweeperOnIdenticalCollection = config.noRequestSweeperOnIdenticalCollection ?? true;
  profile.followCollectionAfterRequestTrack = config.followCollectionAfterRequestTrack ?? true;

  profile.intros = createTrackCollection(
    '$_intros',
    intros,
    `${stationId}/${profileId}`
  );

  profile.requestSweepers = createTrackCollection(
    '$_req_sweepers',
    requestSweepers,
    `${stationId}/${profileId}`
  );

  if (sweeperRules?.length) {
    profile.sweeperRules = sweeperRules.map(({ from, to, path }, index) => ({
      from,
      to,
      collection: createTrackCollection(
        `$_sweepers/${index}`,
        [path],
        `${stationId}/${profileId}`
      )
    }))
  }

  return profile;
}

export async function createStation(stationConfig: StationConfig & { id: string; musicDb: MusicDb }): Promise<Station> {
  return new Promise<Station>(async (resolve) => {
    const { id, musicDb, musicCollections, profiles, ...config } = stationConfig;

    const station = new Station({
      ...config,
      id,
      musicDb
    });

    for (const [id, desc] of Object.entries(musicCollections)) {
      if (!desc.auxiliary) {
        await station.addCollection({
          id,
          ...desc,
          logPrefix: station.id
        });
      }
    }

    for (const [id, config] of Object.entries(profiles)) {
      station.addProfile(createStationProfile(station, {
        id,
        ...config
      }));
    }

    station.changeProfile('default');

    resolve(station);

    for (const [id, desc] of Object.entries(musicCollections)) {
      if (desc.auxiliary) {
        station.addCollection({
          id,
          disableLatch: true,
          noFollowOnRequest: true,
          ...desc,
          logPrefix: station.id
        });
      }
    }
  })
}

export async function createAutomaton(cfg: AutomatonConfig & { id: string; createdStations: Station[] }) {
  return new Promise<MedleyAutomaton>(async (resolve) => {
    const { id, botToken, clientId, baseCommand, owners, guilds, createdStations } = cfg;

    const allowedStations = cfg.stations?.length ? createdStations.filter(s => cfg.stations!.includes(s.id)) : createdStations;
    const stationRepo = new StationRegistry(...allowedStations);
    const automaton = new MedleyAutomaton(stationRepo, {
      id,
      botToken,
      clientId,
      baseCommand,
      owners,
      guilds,
    });

    automaton.once('ready', () => resolve(automaton));

    await automaton.login();
  });
}

let version: string;

export function getVersion() {
  if (version) {
    return;
  }

  if (process.env.npm_package_version) {
    return version = process.env.npm_package_version;
  }

  try {
    return version = require(join(process.cwd(), 'package.json')).version;
  }
  catch {

  }

  return version = 'unknown';
}

export function getVersionLine() {
  const appVersion = getVersion();
  const electronVersion = process.versions['electron'];
  const runtime = electronVersion ? 'Electron' : 'NodeJS';
  const runtimeVersion = electronVersion ? `v${electronVersion}` : process.version;

  return `Medley v${appVersion} running on ${runtime} ${runtimeVersion}; abi=${process.versions.modules}; uv=${process.versions.uv}; v8=${process.versions.v8}`;
}

export async function showVersionBanner(file: string) {
  const gradient = ['#961cb9', '#07d569', '#1c92f6'];

  require('cfonts').say('Medley', {
    font: 'slick',
    gradient,
    transitionGradient: true
  });

  const info = await readFile(file)
    .then(s => s.toString().split(/\r?\n/).map(l => l.trim()).filter(l => l !== ''))
    .catch(() => false as const);

  if (!info) {
    return;
  }

  function centered(s: string) {
    const pad = ' '.repeat(48 - (s.length / 2));
    return `${pad}${s}${pad}`;
  }

  const gs = require('gradient-string')(gradient);
  const hr = '-'.repeat(96);
  [
    hr,
    ...info.map(centered),
    hr
  ].forEach(l => console.log(gs(l)));
}
