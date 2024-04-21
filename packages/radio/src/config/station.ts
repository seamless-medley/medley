import { TrackAddingMode } from "@seamless-medley/core";
import { z } from "zod";

const WatchOptions = z.object({

})

const WatchPathWithOption = z.object({
  dir: z.string().min(1),
  options: WatchOptions.optional()
});

type WatchPathWithOption = z.infer<typeof WatchPathWithOption>

const MusicCollectionWatch = z.union([
  z.string().transform<WatchPathWithOption>(dir => ({ dir })),
  WatchPathWithOption
])

export const MusicCollection = z.object({
  paths: z.array(MusicCollectionWatch).nonempty(),
  description: z.string(),

  auxiliary: z.boolean().optional(),
  noFollowOnRequest: z.boolean().optional(),
  disableLatch: z.boolean().optional(),
  newTracksAddingMode: z.custom<TrackAddingMode>().optional(),
  reshuffleEvery: z.number().nonnegative().optional(),
}).strict();

export type MusicCollection = z.infer<typeof MusicCollection>;

export const SequenceChance = z.union([
  z.literal('random'),
  z.object({
    yes: z.number().nonnegative(),
    no: z.number().nonnegative()
  })
]);

export type SequenceChance = z.infer<typeof SequenceChance>;

export const SequenceLimiter = z.discriminatedUnion('by', [
  z.object({
    by: z.literal('upto'),
    upto: z.number().nonnegative()
  }),
  z.object({
    by: z.literal('range'),
    range: z.object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative()
    })
  }),
  z.object({
    by: z.literal('sample'),
    list: z.number().nonnegative().array()
  }),
  z.object({
    by: z.literal('one-of'),
    list: z.number().nonnegative().array()
  })
]);

export type SequenceLimiter = z.infer<typeof SequenceLimiter>;

export const SequenceLimit = z.union([
  z.number().nonnegative(),
  z.literal('entirely'),
  SequenceLimiter
]);

export type SequenceLimit = z.infer<typeof SequenceLimit>;

export const SequenceConfig = z.object({
  collections: z.array(z.object({
    id: z.string().min(1),
    weight: z.number().optional()
  })),
  chance: SequenceChance.optional(),
  limit: SequenceLimit
}).strict();

export type SequenceConfig = z.infer<typeof SequenceConfig>;

export const SweeperRule = z.object({
  from: z.string().array().nonempty().optional(),
  to: z.string().array().nonempty().optional(),
  path: z.string().min(1)
})
.strict()
.refine(
  ({ from, to }) => from !== undefined || to !== undefined,
  { message: 'Both `from` and `to` cannot be omitted'}
);

export type SweeperRule = z.infer<typeof SweeperRule>;

export const StationProfile = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  intros: z.string().array().optional(),
  sweeperRules: z.array(SweeperRule).optional(),
  requestSweepers: z.string().array().optional(),
  followCollectionAfterRequestTrack: z.boolean().optional(),
  noRequestSweeperOnIdenticalCollection: z.boolean().optional(),
  sequences: z.array(SequenceConfig)
})
.strict();

export type StationProfile = z.infer<typeof StationProfile>;

export const StationProfiles =  z.record(
  z.string().min(1),
  StationProfile
)
.refine(
  (record) => typeof record.default !== 'undefined',
  { message: 'The mandatory profile name `default` was not found' }
);


export type StationProfiles = z.infer<typeof StationProfiles>;

export const StationConfig = z.object({
  name: z.string().min(1),
  description: z.string(),

  url: z.string().min(1).optional(),
  iconURL: z.string().min(1).optional(),

  maxTrackHistory: z.number().optional(),
  artistBacklog: z.union([
    z.number(),
    z.literal(false),
  ]).optional(),
  duplicationSimilarity: z.number().optional(),

  musicCollections: z.record(MusicCollection),

  profiles: StationProfiles
}).strict();

export type StationConfig = z.infer<typeof StationConfig>;
