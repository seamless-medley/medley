import { atom } from "jotai";
import { initClient } from "../init";
import { MedleyClient } from "../medley-client";

export const clientAtom = atom<MedleyClient>(initClient());
