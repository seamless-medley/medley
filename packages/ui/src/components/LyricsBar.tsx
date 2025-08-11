import { useCallback, useEffect, useRef, useState } from "react";
import { useForceUpdate } from "@mantine/hooks";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useDeck } from "@ui/hooks/useDeck";
import { useStation } from "@ui/hooks/useStation";
import { client } from "@ui/init";
import { EnhancedLine, findLyricLine } from "@seamless-medley/utils";
import { TransitionText } from "./TransitionText";

export const LyricsBar: React.FC<{ stationId: string}> = ({ stationId }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const { deck } = useDeck(stationId, activeDeck);

  const line = useRef(-1);
  const update = useForceUpdate();

  const [style] = useState({ alignItems: 'center' });

  const lyrics = deck?.trackPlay?.()?.track?.extra?.coverAndLyrics?.lyrics;

  const handlePosChange = useCallback((pos: number) => {
    if (!lyrics) {
      line.current = -1;
      return;
    }

    const found = findLyricLine(lyrics.timeline, (pos - client.latency) * 1000, line.current);

    if (found !== -1 && found !== line.current) {
      line.current = found;
      update();
    }
  }, [lyrics]);

  useEffect(() => {
    if (!deck) {
      return;
    }

    line.current = -1;
    update();

    handlePosChange(deck.cp());

    return deck.addPropertyChangeListener('cp', handlePosChange);
  }, [deck]);

  const lyricText = (() => {
    if (line.current < 0) return undefined;
    const ll = lyrics?.timeline?.[line.current];

    return lyrics?.type === 'sync'
      ? ll?.line as string
      : (ll?.line as EnhancedLine)?.map(l => l.token).join('')
  })();

  return (
    <>
      <TransitionText
        size="1.2em"
        display="flex"
        truncate="end"
        style={style}
      >
        {lyricText}
      </TransitionText>
    </>
  )
}
