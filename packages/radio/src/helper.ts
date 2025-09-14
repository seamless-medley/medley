import { readFile } from 'node:fs/promises';
import { exists } from 'fs-extra';

import { isString, partition } from "lodash";

import { version } from './version';

import {
  BoomBoxTrack,
  Crate,
  MusicCollectionWatch,
  MusicDb,
  MusicLibrary,
  MusicTrackCollection,
  Station,
  StationProfile,
  StationRegistry,
  StationTrack,
  WatchTrackCollection,
  crateLimitFromSequenceLimit,
  createChanceable,
  scanDir
} from "./core";

import type {
  StationConfig,
  SequenceConfig,
  StationProfile as StationProfileConfig
} from './config/station';

import type { AutomatonConfig } from "./config/automaton";
import { MedleyAutomaton } from "./discord/automaton";

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

export type StationCreationConfig = StationConfig & {
  id: string;
  musicDb: MusicDb;
  onCollectionsScanned?: () => any;
};

export async function createStation(creationConfig: StationCreationConfig): Promise<Station> {
  return new Promise<Station>(async (resolve) => {
    const {
      id: stationId,
      onCollectionsScanned,
      musicDb,
      musicCollections,
      profiles,
      ...config
    } = creationConfig;

    const station = new Station({
      ...config,
      id: stationId,
      musicDb
    });

    const [
      auxiliaryCollectionEntries,
      mandatoryCollectionEntries
    ] = partition(Object.entries(musicCollections), ([id, desc]) => desc.auxiliary);

    const pendingCollectionIds = new Set(Object.keys(musicCollections));

    const handleScanDoneEvent = (collection?: MusicTrackCollection<Station>) => {
      if (!onCollectionsScanned || !collection) {
        return;
      }

      collection.once('scan-done' as any, () => {
        pendingCollectionIds.delete(collection.id);

        if (pendingCollectionIds.size == 0) {
          onCollectionsScanned?.();
        }
      });
    }

    for (const [id, desc] of mandatoryCollectionEntries) {
      const collection = await station.addCollection({
        id,
        ...desc,
        logPrefix: station.id
      });

      handleScanDoneEvent(collection);
    }

    for (const [id, config] of Object.entries(profiles)) {
      station.addProfile(createStationProfile(station, {
        id,
        ...config
      }));
    }

    station.changeProfile('default');

    resolve(station);

    for (const [id, desc] of auxiliaryCollectionEntries) {
      station.addCollection({
        id,
        disableLatch: true,
        noFollowOnRequest: true,
        ...desc,
        logPrefix: station.id
      })
      .then(handleScanDoneEvent);
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
      globalMode: !Boolean(process.env.DEBUG),
      botToken,
      clientId,
      baseCommand,
      owners,
      guilds
    });

    await automaton.login().finally(() => resolve(automaton));
  });
}

type VersionInfo = {
  version: string;
  buildDate?: Date;
}

let buildInfo: VersionInfo = {
  version: 'dev',
  buildDate: new Date()
}

export async function loadBuildInfo(file: string): Promise<VersionInfo> {
  if (await exists(file)) {
    const data = await readFile(file, 'utf-8').then(JSON.parse);

    buildInfo = {
      version,
      buildDate: data?.buildDate ? new Date(data.buildDate) : undefined
    }
  }

  return buildInfo;
}

export function getVersion() {
  return buildInfo.version;
}

export function getVersionLine() {
  const electronVersion = process.versions['electron'];
  const runtime = electronVersion ? 'Electron' : 'NodeJS';
  const runtimeVersion = electronVersion ? `v${electronVersion}` : process.version;

  return `Medley version ${getVersion()} running on ${runtime} ${runtimeVersion}; abi=${process.versions.modules}; uv=${process.versions.uv}; v8=${process.versions.v8}`;
}

export async function showVersionBanner() {
  const gradient = ['#961cb9', '#07d569', '#1c92f6'];

  require('cfonts').say('Medley', {
    font: 'slick',
    gradient,
    transitionGradient: true
  });

  const info = [
    `Medley ${buildInfo.version}`,
    ...(buildInfo?.buildDate ? [`Build Date: ${buildInfo.buildDate}`] : [])
  ];

  function centered(s: string) {
    const pad = ' '.repeat(48 - (s.length / 2));
    return `${pad}${s}${pad}`;
  }

  const hr = '-'.repeat(96);
  [
    hr,
    ...info.map(centered),
    hr
  ].forEach(l => console.log(l));
}

export async function compactMusicDb(library: MusicLibrary<any>) {
  const collections = library.all();
  const trackIds = new Set(collections.flatMap(collection => collection.all().map(track => track.id)));

  return await library.musicDb.validateTracks(async (trackId) => trackIds.has(trackId));
}
