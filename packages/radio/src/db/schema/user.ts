import { z } from "zod";
import { NonEmptyString, WithId } from "./base";

export const User = WithId.extend({
  username: NonEmptyString
});

export type User = z.infer<typeof User>;

export const UserCredential = User.extend({
  password: NonEmptyString,
});

export type UserCredential = z.infer<typeof UserCredential>;
