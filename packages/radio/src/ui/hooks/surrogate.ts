import { useEffect, useState } from "react";
import { useForceUpdate } from "@mantine/hooks";
import type { RemoteTypes } from "../../remotes";
import type { Stub, Remotable } from "../../socket";
import { useRemotableProps } from "./remotable";
import { RemoteObserveOptions } from "../../socket";
import { client } from "../init";

type SurrogateState<T> = {
  surrogate?: Remotable<T>;
  error?: Error;
}

export function useSurrogate<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id: string | undefined,
  options?: RemoteObserveOptions
): SurrogateState<T> {
  const [state, setState] = useState<SurrogateState<T>>({});

  const update = useForceUpdate();

  const onStart = () => void update();
  const onDisconnect = () => setState({ surrogate: undefined });

  useEffect(() => {
    if (id && client.connected) {
      client.surrogateOf<Kind>(StubClass as any, kind, id, options)
        .then((s) => {
          setState({ surrogate: s as unknown as Remotable<T> });
        })
        .catch(e => {
          setState({ error: e });
        });
    }

    client.on('start', onStart);
    client.on('disconnect', onDisconnect);

    return () => {
      state?.surrogate?.dispose();

      client.off('start', onStart);
      client.off('disconnect', onDisconnect);
    }
  }, [id, client.connected, client.session]);

  return state as SurrogateState<T>;
}

/**
 *
 * @deprecated
 */
export function useSurrogateWithRemotable<
  T extends RemoteTypes[Kind],
  Kind extends keyof RemoteTypes
>(
  StubClass: Stub<T>,
  kind: Kind,
  id: string
) {
  const { surrogate: remote, error } = useSurrogate(StubClass, kind, id);
  const values = useRemotableProps(remote);

  return [remote, values, error] as const;
}
