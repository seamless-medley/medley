import { Crate, MusicDb, Station, StationProfile, StationRegistry, StationTrack, WatchTrackCollection, crateLimitFromSequenceLimit, createChanceable, scanDir } from "@seamless-medley/core";
import normalizePath from "normalize-path";

import {
  type StationConfig,
  type SequenceConfig,
  type StationProfile as StationProfileConfig
} from './config/station';
import { AutomatonConfig } from "./config/automaton";
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

function createTrackCollection(id: string, paths: string[] = [], logPrefix: string) {
  const collection = new WatchTrackCollection(id, undefined, { logPrefix, scanner: scanDir });

  for (const path of paths) {
    collection.watch(normalizePath(path));
  }

  return collection;
}

export function createStationProfile(station: Station, config: StationProfileConfig & { id: string }) {
  const {
    id,
    name,
    description,
    intros,
    sweeperRules,
    requestSweepers,
    sequences
  } = config;

  const stationId = station.id;

  const crates = sequences
    .map((seq, index) => createCrateFromSequence(`${id}/${index}-${seq.collections.map(c => c.id)}`, station, seq))
    .filter((c): c is Crate<StationTrack> => c !== undefined);

  const profile = new StationProfile({
    id,
    name,
    description,
    crates
  });

  profile.noRequestSweeperOnIdenticalCollection = config.noRequestSweeperOnIdenticalCollection ?? true;
  profile.followCrateAfterRequestTrack = config.followCrateAfterRequestTrack ?? true;

  profile.intros = createTrackCollection(
    '$_intros',
    intros,
    stationId
  );

  profile.requestSweepers = createTrackCollection(
    '$_req_sweepers',
    requestSweepers,
    stationId
  );

  if (sweeperRules?.length) {
    profile.sweeperRules = sweeperRules.map(({ from, to, path }) => ({
      from,
      to,
      collection: createTrackCollection(
        `$_sweepers/${path}`,
        [path],
        stationId
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
    const { id, botToken, clientId, baseCommand, guilds, createdStations } = cfg;

    const allowedStations = cfg.stations?.length ? createdStations.filter(s => cfg.stations!.includes(s.id)) : createdStations;
    const stationRepo = new StationRegistry(...allowedStations);
    const automaton = new MedleyAutomaton(stationRepo, {
      id,
      botToken,
      clientId,
      baseCommand,
      guilds
    });

    automaton.once('ready', () => resolve(automaton));

    await automaton.login();
  });
}
