import { PlainUser, User } from "../persistent/user";
import { $ActualObject, createModel } from "./base";
import { UserFlags } from "../../flags";

export class UserModel extends createModel<User>('UserModel') {
  isAdmin() {
    return this.flags.has(UserFlags.Flags.ADMIN);
  }

  toPlain() {
    return PlainUser.parse(this[$ActualObject]);
  }
}
