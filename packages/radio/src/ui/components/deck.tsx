import { DeckIndex } from "@seamless-medley/core";
import React from "react";
import { Station } from "../../socket/remote/station";
import { Remotable } from "../../socket/types";
import { useDeck } from "../hooks/useDeck";

export type DeckProps = {
  station?: Remotable<Station>;
  index: DeckIndex;
}

export const Deck: React.FC<DeckProps> = ({ station, index }) => {
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
