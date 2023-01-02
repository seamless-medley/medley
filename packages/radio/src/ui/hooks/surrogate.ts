import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { RemoteTypes } from "../../socket/remote";
import type { Stub } from "../../socket/stub";
import type { Remotable } from "../../socket/types";
import { clientAtom } from "../atoms/client";

export function useSurrogate<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id: string
) {
  const client = useAtomValue(clientAtom);
  const [remote, setRemote] = useState<Remotable<T>>();

  useEffect(() => {
    let _s: typeof remote;
    client.surrogateOf<Kind>(StubClass as any, kind, id).then(s => {
      _s = s as any;
      setRemote(s as any);
    })

    return () => void _s?.dispose();
  }, []);

  return remote;
}
