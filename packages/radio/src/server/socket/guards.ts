import type { GuardPredicate } from "./types";

export const loggedIn: GuardPredicate = socket => socket.data?.user !== undefined;
