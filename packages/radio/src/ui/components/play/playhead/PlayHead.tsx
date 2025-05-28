import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { Box, Container, Mask, Next, ProgressText } from "./elements";
import type { DeckIndex } from "@seamless-medley/medley";
import { useDeck } from "../../../hooks/useDeck";
import { client } from "../../../init";
import { getNextDeck } from "../../../pages/play/view";
import { useRemotableProp } from "../../../hooks/remotable";
import { formatTags } from "@seamless-medley/utils";

interface Props {
  stationId?: string;
  deckIndex: DeckIndex;

  backgroundColor: string;
  textColor: string;
  activeColor: string;
}

function format(seconds: number) {
  const mm = Math.trunc(seconds / 60);
  const ss = Math.trunc(seconds % 60);
  return [mm, ss].map(e => e.toString().padStart(2, '0')).join(':')
}

export const PlayHead: React.FC<PropsWithChildren<Props>> = (props) => {
  const containerEl = useRef<HTMLDivElement>(null);
  const maskEl = useRef<HTMLDivElement>(null);

  const { stationId, deckIndex, backgroundColor, textColor } = props;

  const { deck } = useDeck(stationId, deckIndex);
  const nextDeckIndex = getNextDeck(deckIndex);
  const { deck: nextDeck } = useDeck(stationId, nextDeckIndex);

  const nextTrackPlay = useRemotableProp(nextDeck, 'trackPlay');
  const [nextTrack, setNextTrack] = useState<string | undefined>();
  const [showNext, setShowNext] = useState(false);

  const hideNextTimer = useRef<number>();

  const [text, setText] = useState('');

  const updateProgress = useCallback((position: number, duration: number) => {
    if (duration && maskEl.current) {
      const progress = position / duration;
      maskEl.current.style.clipPath = `inset(0 0 0 ${(progress) * 100}%)`;
    }
  }, [deck, maskEl.current])

  const handleChange = useCallback((cp: number) => {
    const position = cp - client.latency;
    setText(format(position));

    const duration = deck?.getProperties().duration;
    if (duration) {
      updateProgress(position, duration);
    }
  }, [deck, updateProgress]);

  useEffect(() => {
    if (!deck) {
      return;
    }

    const position = deck.getProperties().cp - client.latency;
    setText(format(position));

    const duration = deck.getProperties().duration;

    if (duration) {
      updateProgress(position, duration);
    }

    return deck.addPropertyChangeListener('cp', handleChange);
  }, [deck, handleChange]);

  const cancelHide = () => clearTimeout(hideNextTimer.current);

  useEffect(() => {
    cancelHide();

    const tags = nextTrackPlay?.track?.extra?.tags;
    const next = tags ? formatTags(tags) : undefined;

    if (next) {
      setNextTrack(next);
      setShowNext(true);
      return;
    }

    setShowNext(false);
    hideNextTimer.current = setTimeout(() => setNextTrack(undefined), 4000) as unknown as number;

    return cancelHide;
  }, [nextTrackPlay?.track?.extra?.tags]);

  const clockChars = text.split('').map((c, i) => <span key={i}>{c}</span>);

  return (
    <>
      <Container ref={containerEl} className={classNames({ withNext: showNext })}>
        <Box>
          <ProgressText
            backgroundColor={backgroundColor}
            textColor={textColor}
          >
            {clockChars}
          </ProgressText>

          <Mask ref={maskEl} />
        </Box>
      </Container>

      <Next
        style={{ minWidth: `calc(${containerEl.current?.clientWidth ?? 0}px - 0.4em * 2)` }}
        color={props.activeColor}
        className={classNames({ show: showNext })}
      >
        <span>{nextTrack && 'Next: '}{nextTrack}</span>
      </Next>
    </>
  )
}
