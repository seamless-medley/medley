import { atom } from "jotai";
import type { RemoteTypes } from "../../remotes/core";
import type { Client } from "../client";
import { initClient } from "../init";

export const clientAtom = atom<Client<RemoteTypes>>(initClient());
