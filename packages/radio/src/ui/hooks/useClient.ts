import { useCallback, useEffect, useState } from "react";
import { client } from "../init";


export function usePlayingStationId() {
  const [id, setId] = useState<string>();

  const handler = useCallback(setId, []);

  useEffect(() => {
    client.on('playingStation', handler);

    return () => {
      client.off('playingStation', handler);
    }
  }, []);

  return id;
}
