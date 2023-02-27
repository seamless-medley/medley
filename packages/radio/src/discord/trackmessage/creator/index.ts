import { isEmpty, omit, sample } from 'lodash';
import { TrackMessageCreator } from './base';
import { Extended } from './extended';
import { Normal } from './normal';
import { Simple } from './simple';

export * from './normal';
export * from './extended';

const creators = {
  normal: Normal,
  extended: Extended,
  simple: Simple
} as const;

export type Creators = typeof creators;

export type CreatorNames = keyof Creators;

export const creatorNames = new Set<CreatorNames>(Object.keys(creators) as CreatorNames[]);

export const getCreator = (name: CreatorNames) => creators[name];

export function makeCreator(name: CreatorNames): TrackMessageCreator;
export function makeCreator(name: 'random', names?: CreatorNames[]): TrackMessageCreator;
export function makeCreator(name: CreatorNames | 'random', names?: CreatorNames[]): TrackMessageCreator {
  const creator = getCreator(name === 'random'
    ? sample(
      !isEmpty(names)
      ? names
      : omit([...creatorNames], 'simple')
    )!
    : name);

  return new creator;
};
