import { useEffect, useState } from "react";
import type { RemoteTypes } from "../../socket/remote";
import type { Stub } from "../../socket/stub";
import type { Remotable } from "../../socket/types";
import { useRemotable } from "./remotable";
import { useClient } from "./useClient";

export function useSurrogate<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id: string
) {
  const client = useClient();
  const [remote, setRemote] = useState<Remotable<T>>();

  useEffect(() => {
    let _s: typeof remote;
    client.surrogateOf<Kind>(StubClass as any, kind, id).then(s => {
      _s = s as any;
      setRemote(s as any);
    });

    return () => void _s?.dispose();
  }, []);

  return remote;
}

export function useSurrogateWithRemotable<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id: string
) {
  const remote = useSurrogate(StubClass, kind, id);
  const values = useRemotable(remote);

  return [remote, values] as const;
}
