import { useForceUpdate } from "@mantine/hooks";
import { useEffect, useState } from "react";
import type { RemoteTypes } from "../../socket/remote";
import type { Stub } from "../../socket/stub";
import type { Remotable } from "../../socket/types";
import { useRemotableProps } from "./remotable";
import { useClient } from "./useClient";

export function useSurrogate<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id?: string
) {
  const client = useClient();
  const [remote, setRemote] = useState<Remotable<T>>();

  const update = useForceUpdate();

  const onConnect = () => void update();
  const onDisconnect = () => setRemote(undefined);

  useEffect(() => {
    let _s: typeof remote;

    if (id && client.ready) {
      client.surrogateOf<Kind>(StubClass as any, kind, id)
        .then(s => {
          _s = s as any;
          setRemote(s as any);
        })
        .catch((e) => {
          console.error('Could not get surrogate', e);
        });
    }

    client.on('connect', onConnect);
    client.on('disconnect', onDisconnect);

    return () => {
      _s?.dispose();

      client.off('connect', onConnect);
      client.off('disconnect', onDisconnect)
    }
  }, [id, client.ready]);

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
  const values = useRemotableProps(remote);

  return [remote, values] as const;
}