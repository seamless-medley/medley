import React, { useCallback, useEffect, useState } from "react";
import { css } from "@linaria/core";
import { styled } from "@linaria/react";
import { Box, Text, TextProps } from "@mantine/core";
import type { DeckIndex } from "@seamless-medley/medley";
import { useDeck } from "@ui/hooks/useDeck";

const PlayHeadStyledText = styled(Text)`
  display: inline-block;
  text-align: center;
  user-select: none;
  width: 1ch;
`;

const PlayHeadChar: React.FC<TextProps & { children: string }> = ({ children: text, ...props }) => (
  text.split('').map((c, index) => <PlayHeadStyledText key={index} {...props} span>
    {c}
  </PlayHeadStyledText>)
)

const punc = css`
  transform: translateY(-0.1em);
`;

const colon = css`
  transform: translateY(-0.1em);
  width: 0.5ch;
`;

const Container = styled(Box)`
  position: relative;
  width: max-content;
  height: fit-content;
  transition: color 1s ease;
`;

type PlayHeadTextProps = TextProps & {
  stationId: string;
  deckIndex: DeckIndex;
  showDuration?: boolean;
}

export const PlayHeadText: React.FC<PlayHeadTextProps> = React.memo(({ stationId, deckIndex, showDuration = true, ...textProps }) => {
  const { deck } = useDeck(stationId, deckIndex);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isRemaining, setShowRemaining] = useState(false);

  const handlePosChange = useCallback((pos: number) => {
    setTime(Math.trunc(pos));
  }, [deck]);

  const handleDurationChange = useCallback((duration?: number) => {
    setDuration(duration ?? 0);
  }, [deck]);

  useEffect(() => {
    if (!deck) {
      return;
    }

    setTime(Math.trunc(deck.cp()));
    setDuration(deck.duration?.() ?? 0);

    const cleanupHandlers = [
      deck.addPropertyChangeListener('cp', handlePosChange),
      deck.addPropertyChangeListener('duration', handleDurationChange),
    ];

    return () => void cleanupHandlers.map(fn => void fn());
  }, [deck]);

  const tick = duration > 0
    ? (isRemaining ? duration - time : time)
    : 0;

  const [time_mm, time_ss] = [(tick / 60) % 99, tick % 60].map(v => Math.trunc(v).toString())
  const [duration_mm, duration_ss] = showDuration ? [(duration / 60) % 99, duration % 60].map(v => Math.trunc(v).toString()) : [];

  return (
    <Container onClick={() => setShowRemaining(prev => !prev)}>
      {isRemaining ?
        (<PlayHeadChar {...textProps} className={punc}>
          -
        </PlayHeadChar>)
        : undefined
      }

      <PlayHeadChar {...textProps}>
        {time_mm.padStart(2, '0')}
      </PlayHeadChar>

      <PlayHeadChar
        {...textProps}
        className={colon}
      >
        :
      </PlayHeadChar>

      <PlayHeadChar {...textProps}>
        {time_ss.padStart(2, '0')}
      </PlayHeadChar>

      {duration_mm && duration_ss ? (
        <>
          <PlayHeadChar {...textProps}>
            /
          </PlayHeadChar>

          <PlayHeadChar {...textProps}>
            {duration_mm.padStart(2, '0')}
          </PlayHeadChar>

          <PlayHeadChar
            {...textProps}
            className={colon}
          >
            :
          </PlayHeadChar>

          <PlayHeadChar {...textProps}>
            {duration_ss.padStart(2, '0')}
          </PlayHeadChar>
        </>)
        : undefined
      }

    </Container>
  )
});
