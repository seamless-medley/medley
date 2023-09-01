import { TrackAddingMode } from "@seamless-medley/core";
import { z } from "zod";

export const MusicCollection = z.object({
  path: z.string().nonempty(),
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

export const Sequence = z.object({
  collections: z.array(z.object({
    id: z.string().nonempty(),
    weight: z.number().optional()
  })),
  chance: SequenceChance.optional(),
  limit: SequenceLimit
}).strict();

export type Sequence = z.infer<typeof Sequence>;

export const SweeperRule = z.object({
  from: z.string().array().nonempty().optional(),
  to: z.string().array().nonempty().optional(),
  path: z.string().nonempty()
})
.strict()
.refine(
  ({ from, to }) => from !== undefined || to !== undefined,
  { message: 'Both `from` and `to` cannot be omitted'}
);

export type SweeperRule = z.infer<typeof SweeperRule>;

export const StationConfig = z.object({
  name: z.string().nonempty(),
  description: z.string(),

  url: z.string().nonempty().optional(),
  iconURL: z.string().nonempty().optional(),

  maxTrackHistory: z.number().optional(),
  artistBacklog: z.union([
    z.number(),
    z.literal(false),
  ]).optional(),
  duplicationSimilarity: z.number().optional(),

  followCrateAfterRequestTrack: z.boolean().optional(),
  noRequestSweeperOnIdenticalCollection: z.boolean().optional(),

  intros: z.string().array().optional(),
  requestSweepers: z.string().array().optional(),

  musicCollections: z.record(MusicCollection),
  sequences: z.array(Sequence),
  sweeperRules: z.array(SweeperRule).optional()
}).strict();

export type StationConfig = z.infer<typeof StationConfig>;
