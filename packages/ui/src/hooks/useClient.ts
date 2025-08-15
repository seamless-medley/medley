import { useCallback, useEffect, useState } from "react";
import { client } from "@ui/init";


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
