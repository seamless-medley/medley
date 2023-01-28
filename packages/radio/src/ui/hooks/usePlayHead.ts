import { useEffect } from "react";
import { AudioTransportExtra } from "../../audio/types";
import { useClient } from "./useClient";

export type UsePlayHeadData = {
  deck: number | undefined;
  position: number;
}

export function usePlayHead(callback: (data: UsePlayHeadData) => any) {
  const client = useClient();

  let raf = 0;

  const handleAudioExtra = ([deck, position]: AudioTransportExtra) => {
    raf = requestAnimationFrame(() => {
      callback({ deck, position });
      raf = 0;
    });
  }


  useEffect(() => {
    client.on('audioExtra', handleAudioExtra);

    return () => {
      cancelAnimationFrame(raf);
      client.off('audioExtra', handleAudioExtra);
    }
  }, []);
}
