import { z } from "zod";
import { NonEmptyString, WithId } from "./base";

export const User = WithId.extend({
  username: NonEmptyString,
  password: NonEmptyString,
});

export type User = z.infer<typeof User>;
