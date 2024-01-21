import { useEffect, useReducer } from "react";
import { useForceUpdate } from "@mantine/hooks";
import type { RemoteTypes } from "../../remotes";
import type { Stub, Remotable } from "../../socket";
import { useRemotableProps } from "./remotable";
import { useClient } from "./useClient";
import { RemoteObserveOptions } from "../../socket";

type SurrogateState<T> = {
  surrogate?: Remotable<T>;
  error?: Error;
}

type SurrogateAction =
  { type: 'set', surrogate?: Remotable<any> } |
  { type: 'error', error?: Error }

const useSurrogateReducer = <T>(state: SurrogateState<T>, action: SurrogateAction) => {
  switch (action.type) {
    case 'set':
      return { surrogate: action.surrogate };
    case 'error':
      return { error: action.error };
    default:
      return state;
  }
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
  const client = useClient();

  const [state, dispatch] = useReducer(useSurrogateReducer, {});

  const update = useForceUpdate();

  const onConnect = () => void update();
  const onDisconnect = () => dispatch({ type: 'set', surrogate: undefined });

  useEffect(() => {
    if (id && client.ready) {
      client.surrogateOf<Kind>(StubClass as any, kind, id, options)
        .then(s => {
          dispatch({ type: 'set', surrogate: s });
        })
        .catch(e => {
          dispatch({ type: 'error', error: e });
        });
    }

    client.on('connect', onConnect);
    client.on('disconnect', onDisconnect);

    return () => {
      state.surrogate?.dispose();

      client.off('connect', onConnect);
      client.off('disconnect', onDisconnect)
    }
  }, [id, client.ready]);

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
