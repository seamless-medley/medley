import { atom } from "jotai";
import type { RemoteTypes } from "../../socket/remote";
import type { Client } from "../client";
import { initClient } from "../init";

export const clientAtom = atom<Client<RemoteTypes>>(initClient());
