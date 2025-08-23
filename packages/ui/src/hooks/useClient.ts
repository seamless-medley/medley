import { useCallback, useEffect, useState } from "react";
import { client } from "@ui/init";

export function useSession() {
  const [session, setSession] = useState(client.session ?? {});

  const handler = useCallback(() => setSession(client.session ?? {}), []);

  useEffect(() => {
    client.on('start', handler);

    return () => {
      client.off('start', handler);
    }
  }, []);

  return session;
}

export function usePlayingStationId() {
  const [id, setId] = useState(client.playingStationId);

  const handler = useCallback(setId, []);

  useEffect(() => {
    client.on('playingStation', handler);

    return () => {
      client.off('playingStation', handler);
    }
  }, []);

  return id;
}
