import { z } from "zod";
import { UserFlags } from "../../flags";
import { BigIntFlags, BitFieldString, NonEmptyString, WithId, WithPlainId } from "./base";

export const User = WithId.extend({
  username: NonEmptyString,
  flags: BigIntFlags(UserFlags)
});

export type User = z.infer<typeof User>;

export const PlainUser = WithPlainId(User).extend({
  flags: BitFieldString(UserFlags)
});
