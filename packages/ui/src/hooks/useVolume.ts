import { client } from "@ui/init";
import { useEffect, useState } from "react";

export function useVolume() {
  const [gain, setGain] = useState(client.volume);

  useEffect(() => {
    client.on('volume', setGain);

    return () => {
      client.off('volume', setGain);
    }
  }, [client.volume]);

  return gain;
}
