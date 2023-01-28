import React from "react";
import { DeckIndex } from "@seamless-medley/core";
import { Station } from "../../socket/remote";
import { Remotable } from "../../socket/types";
import { useDeck } from "../hooks/useDeck";

export type PlayDeckProps = {
  station?: Remotable<Station>;
  index: DeckIndex;
}

export const PlayDeck: React.FC<PlayDeckProps> = ({ station, index }) => {
  const { info, cover } = useDeck(station, index);

  return (
    <>
      { cover ? <img src={cover} /> : <span>No Imaage</span> }
      { cover }
      <pre style={{ maxWidth: '100vw', overflowX: 'auto' }}>
        {JSON.stringify(info, undefined, 2)}
      </pre>
    </>
  )
}
