import type { User } from "./schema/user";

export interface UserDb {
  verifyLogin(username: string, password: string): Promise<User | undefined>;
}
