import { Constructor } from 'type-fest';
import { TrackMessageCreator } from './base';
import { Extended } from './extended';
import { Normal } from './normal';
import { Simple } from './simple';

export * from './normal';
export * from './extended';

export const creatorNames = ['normal', 'extended', 'simple'] as const;

export type CreatorNames = typeof creatorNames[number];

const defiendCreators: Record<CreatorNames, Constructor<TrackMessageCreator>> = {
  normal: Normal,
  extended: Extended,
  simple: Simple
};

export type Creators = typeof defiendCreators;

export const getCreator = (name: CreatorNames) => defiendCreators[name];

export const makeCreator = (name: CreatorNames) => new (getCreator(name));
