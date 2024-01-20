import type { GuardPredicate } from "./types";

export const authorized: GuardPredicate = socket => socket.data.auth === true;
