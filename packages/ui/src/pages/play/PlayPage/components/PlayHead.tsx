import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import clsx from 'clsx';
import { styled } from '@linaria/react';
import { setLightness, transparentize } from 'polished';

import type { DeckIndex } from "@seamless-medley/medley";
import { formatTags } from "@seamless-medley/utils";

import { useDeck } from "@ui/hooks/useDeck";
import { client } from "@ui/init";
import { useRemotableProp } from "@ui/hooks/remotable";
import { getNextDeck } from "@ui/utils/utils";

const Container = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
  z-index: 30;

  overflow: hidden;

  transition: bottom 4s ease;
  transition-delay: 0.8s;

  will-change: bottom;

  &.withNext {
    bottom: 1.2em;
    transition: bottom 1.2s ease;
    transition-delay: 0s;
  }
`;

const Box = styled.div<{ width?: string }>`
  position: relative;
  padding: 0.44em 0.6em;
  border-radius: 0.25em 0px 0px 0px;
  background-color: rgb(200 200 255 / 0.3);
  transition: all 0.2s ease;
  white-space: nowrap;
  height: 1em;
  min-height: fit-content;
  min-width: 8ch;

  width: ${props => props.width ?? ''};

  transition: width 2s ease, height 2s ease;
`;

const ProgressText = styled.div<{ backgroundColor: string, textColor: string }>`
  position: absolute;
  display: flex;

  justify-content: center;
  align-items: center;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;

  border-radius: 0.25em 0px 0px 0px;

  user-select: none;

  & > span {
    display: inline-block;

    margin-top: -4px;

    width: 0.6em;
    text-align: center;

    color: inherit;
  }

  will-change: background-position, background-image, color;

  background-size: 0.5em 0.5em;
  animation: move 2s linear infinite;

  @keyframes move {
    0% {
      background-position: 0 0;
    }
    100% {
      background-position: 0.5em 0.5em;
    }
  }

  transform: translateZ(0) rotateZ(360deg);
  transition:
    clip-path 0.2s ease,
    background-color 2.2s ease-in-out,
    color 2.2s ease-in-out;

  background-image: linear-gradient(
    -45deg,
    ${props => transparentize(0.3, props.backgroundColor)} 25%,
    transparent 25%,
    transparent 50%,
     ${props => transparentize(0.3, props.backgroundColor)} 50%,
     ${props => transparentize(0.3, props.backgroundColor)} 75%,
    transparent 75%,
    transparent
  );

  color: ${props => setLightness(0.65, props.textColor)};
`;

const Mask = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;

  background-color: rgb(0 0 0 / 0.5);

  transform: translateZ(0) rotateZ(360deg);

  transition: clip-path 0.5s ease;
`

const Next = styled.div<{ color: string }>`
  position: absolute;
  display: flex;

  bottom: 0;
  right: 0;
  z-index: 20;

  min-width: 8ch;

  justify-content: center;
  align-items: center;
  font-size: 0.6em;

  user-select: none;

  padding: 0.4em;
  background-color: rgb(200 200 255 / 0.3);
  white-space: nowrap;
  height: 2.0em;

  color: ${props => props.color};

  opacity: 0;

  transition: opacity 4s ease, color 4s ease, width 2s ease;

  &.show {
    opacity: 1;
    transition: opacity 0.6s ease, color 4s ease, width 2s ease;
  }

  & > * {
    animation: blink 0.5s linear alternate infinite;
  }

  @keyframes blink {
    from {
      opacity: 1;
    }

    to {
      opacity: 0.15;
    }
  }
`;

interface Props {
  stationId?: string;
  deckIndex: DeckIndex | undefined;

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

  const hideNextTimer = useRef<number>(undefined);

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
      <Container ref={containerEl} className={clsx({ withNext: showNext })}>
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
        className={clsx({ show: showNext })}
      >
        <span>{nextTrack && 'Next: '}{nextTrack}</span>
      </Next>
    </>
  )
}
