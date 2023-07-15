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
  const [error, setError] = useState<Error>();
  const ref = useRef<typeof remote>();

  const update = useForceUpdate();

  const onConnect = () => void update();
  const onDisconnect = () => setRemote(undefined);

  useEffect(() => {

    if (id && client.ready) {
      client.surrogateOf<Kind>(StubClass as any, kind, id)
        .then(s => {
          ref.current = s as any;
          setRemote(s as any);
        })
        .catch(setError);
    }

    client.on('connect', onConnect);
    client.on('disconnect', onDisconnect);

    return () => {
      ref.current?.dispose();

      client.off('connect', onConnect);
      client.off('disconnect', onDisconnect)
    }
  }, [id, client.ready]);

  return [remote, error];
}

export function useSurrogateWithRemotable<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id: string
) {
  const [remote, error] = useSurrogate(StubClass, kind, id);
  const values = useRemotableProps(remote);

  return [remote, values, error] as const;
}
