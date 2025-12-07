import { useCallback, useEffect, useRef } from "react";
import { TextProps } from "@mantine/core";
import { useForceUpdate } from "@mantine/hooks";
import { useRemotableProp } from "@ui/hooks/remotable";
import { useDeck } from "@ui/hooks/useDeck";
import { useStation } from "@ui/hooks/useStation";
import { TransitionText } from "@ui/components/TransitionText";
import { client } from "@ui/init";
import { EnhancedLine, findLyricLine } from "@seamless-medley/utils";

type LyricsBarProps = Omit<TextProps, 'style'> & {
  stationId: string;
  inline?: boolean;
  nowrap?: boolean;
  autoscroll?: boolean;
}

export const LyricsBar: React.FC<LyricsBarProps> = ({ stationId, inline, nowrap, autoscroll, ...textProps }) => {
  const { station } = useStation(stationId);
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const { deck } = useDeck(stationId, activeDeck);

  const line = useRef(-1);
  const update = useForceUpdate();

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
        style={{ alignItems: 'center' }}
        inline={inline}
        nowrap={nowrap}
        autoscroll={autoscroll}
        stableId={`${line.current}`}
        {...textProps}
      >
        {lyricText}
      </TransitionText>
    </>
  )
}
