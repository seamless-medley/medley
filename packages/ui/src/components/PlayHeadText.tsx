import React, { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Box, Text, TextProps } from "@mantine/core";
import type { DeckIndex } from "@seamless-medley/medley";
import { useDeck } from "@ui/hooks/useDeck";
import classes from './PlayHeadText.module.css';

const PlayHeadChar: React.FC<TextProps & { children: string }> = ({ children: text, className, ...props }) => (
  text.split('').map((c, index) => <Text key={index} {...props} className={clsx(classes.playhead, className)} span>
    {c}
  </Text>)
)

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
    <Box className={classes.container} onClick={() => setShowRemaining(prev => !prev)}>
      {isRemaining ?
        (<PlayHeadChar {...textProps} className={classes.punc}>
          -
        </PlayHeadChar>)
        : undefined
      }

      <PlayHeadChar {...textProps}>
        {time_mm.padStart(2, '0')}
      </PlayHeadChar>

      <PlayHeadChar
        {...textProps}
        className={classes.colon}
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
            className={classes.colon}
          >
            :
          </PlayHeadChar>

          <PlayHeadChar {...textProps}>
            {duration_ss.padStart(2, '0')}
          </PlayHeadChar>
        </>)
        : undefined
      }

    </Box>
  )
});
