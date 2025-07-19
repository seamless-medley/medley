import { BitField } from "./bitfield";
export class UserFlags extends BitField<UserFlags> {
  static Flags = Object.freeze({
    ADMIN: 1n << 22n,
  });
}
