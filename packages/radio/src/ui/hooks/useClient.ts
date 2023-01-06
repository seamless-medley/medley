import { useAtomValue } from "jotai"
import { clientAtom } from "../atoms/client"

export const useClient = () => useAtomValue(clientAtom);
