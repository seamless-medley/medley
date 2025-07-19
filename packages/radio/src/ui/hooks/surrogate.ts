import { useEffect, useState } from "react";
import { useForceUpdate } from "@mantine/hooks";
import type { RemoteObjects } from "../../remotes/objects";
import { useRemotableProps } from "./remotable";
import { client } from "../init";
import { Remotable } from "../../remotes/types";
import { RemoteObserveOptions } from "../../remotes/socket";

type SurrogateState<T> = {
  surrogate?: Remotable<T>;
  error?: Error;
}

export function useSurrogate<
  T extends RemoteObjects[Kind],
  Kind extends keyof RemoteObjects
>(
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
      client.surrogateOf<Kind>(kind, id, options)
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
export function useSurrogateWithRemotable<Kind extends keyof RemoteObjects>(kind: Kind, id: string) {
  const { surrogate: remote, error } = useSurrogate(kind, id);
  const values = useRemotableProps(remote);

  return [remote, values, error] as const;
}
