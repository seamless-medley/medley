import { type User } from "./persistent/user";

export interface SettingsDb {
  verifyLogin(username: string, password: string): Promise<User | undefined>;
}
