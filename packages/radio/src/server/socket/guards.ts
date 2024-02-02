import type { GuardPredicate } from "./types";

export const loggedIn: GuardPredicate = socket => socket.data?.user !== undefined;

export const isAdmin: GuardPredicate = socket => socket.data?.user?.isAdmin() === true;
