import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clamp, findIndex } from 'lodash';
import type { LyricLine, Lyrics as CoreLyrics, Timeline } from '@seamless-medley/utils';
import { findLyricLine } from '@seamless-medley/utils';
import { DeckIndex } from '@seamless-medley/core';
import { useElementSize } from '@mantine/hooks';
import { useDeck } from '../../../hooks/useDeck';
import { Container, LineColors, Ticker, Line } from './elements';

interface Colors {
  background: string;
  line: LineColors;
}

interface Props {
  lines: number;
  lineHeight: number;
  lyrics: CoreLyrics | undefined;
  colors: Colors | undefined;
  bpm?: number;

  position: number;
}

export const defaultColors = {
  background: 'rgb(2,2,30)',
  line: {
    text: 'rgb(49, 49, 132)',
    active: 'rgb(222, 222, 255)',
    dim: 'rgba(61,61,147,0.5)',
    shadow: 'rgb(80, 80, 210)',
    glow: 'white'
  }
}

const findNextLine = (timeline: Timeline, fromLine: number) => findIndex(timeline, ({ text }) => text.trim().length > 0, fromLine + 1);

export type LyricsProps = {
  stationId?: string; deckIndex:
  DeckIndex; lyrics:
  CoreLyrics | undefined;
  lines: number;
  lineHeight: number;
  colors: Colors | undefined;
  bpm?: number;
}

export const Lyrics: React.FC<LyricsProps> = (props) => {
  const [line, setLine] = useState(-1);
  const { ref: tickerRef, width, height } = useElementSize();
  const lineRefs = useRef<(Line | null)[]>([]);
  const { deck } = useDeck(props.stationId, props.deckIndex);

  const canvas = useMemo(() => tickerRef.current?.parentElement?.querySelector('canvas'), [tickerRef.current]);
  const ctx = useMemo(() => canvas?.getContext('2d'), [canvas]);

  useEffect(() => {
    if (ctx) {
      ctx.font = window.getComputedStyle(tickerRef.current).font;
    }
  });

  // Reset the line and re-render when lyrics changes
  useEffect(() => {
    setLine(-1);
  }, [props.lyrics]);

  // Reset the references to Line components when lyrics changes
  useEffect(() => {
    lineRefs.current = Array(props.lyrics?.timeline?.length ?? 0).fill(null);
  }, [props.lyrics]);

  // calculate ticker position, update on dimensions change
  const position = useMemo(() => {
    const stickyLine = props.lines / 2 - 1;
    const rowHeight = height / props.lines;

    if (line < stickyLine) {
      return -rowHeight * (stickyLine - line + 1) + (rowHeight / 2);
    }

    const topLine = Math.max(0, line - (props.lines / 2) + 1);
    return (topLine * rowHeight) - (rowHeight / 2);
  }, [height, line, props.lines]);

  // find the next line
  const nextLine = useMemo(() => {
    if (!props.lyrics) {
      return -1;
    }

    const n = findNextLine(props.lyrics.timeline, line);
    return n !== line ? n : -1;

  }, [line, props.lyrics]);

  // function to advance the lyric line
  const updateLine = useCallback((ms: number) => {
    const { lyrics } = props;

    if (!lyrics) {
      return;
    }

    const foundLine = findLyricLine(lyrics.timeline, ms, line);

    if (foundLine > -1 && foundLine !== line) {
      setLine(foundLine);
    }
  }, [deck, props.lyrics]);

  const bpm = props.bpm ?? 90;
  const beatInterval = useMemo(() => 6e4 / bpm, [bpm])

  // function to update progress of the next line far indicator
  const updateNextProgress = useCallback((ms: number, line: number) => {
    if (!props.lyrics || line === -1) {
      return;
    }

    const { time, far } = props.lyrics.timeline[line];
    const lineRef = lineRefs.current?.[line];

    if (!far || !lineRef) {
      return;
    }

    const beatTimestamp = time - (8 * beatInterval);

    if (ms >= beatTimestamp) {
      const progress = clamp((time - ms) / (time - beatTimestamp), 0, 1);
      lineRef.setProgress(progress);
    }

  }, [props.lyrics]);

  // Monitor deck's play head
  const handleChange = useCallback((cp: number) => {
    const ms = cp * 1000;
    updateLine(ms);
    updateNextProgress(ms, nextLine);
  }, [deck, updateLine, updateNextProgress, nextLine]);

  // Intialization
  useEffect(() => {
    if (!deck) {
      return;
    }

    const ms = deck.getProperties().cp * 1000;

    updateLine(ms);

    if (props.lyrics?.timeline) {
      updateNextProgress(
        ms,
        findNextLine(props.lyrics.timeline, line)
      );
    }

    return deck.addPropertyChangeListener('cp', handleChange);
  }, [deck, handleChange]);

  const colors = props.colors || defaultColors;

  // function to create Line component for each lyrics line
  const mapLine = (lyricLine: LyricLine, index: number) => {
    // calculate scaling for each line
    let scale = 1;
    let zoomedScale = 1.12;

    if (ctx && tickerRef.current) {
      const textWidth = ctx.measureText(lyricLine.text).width;

      if (textWidth > 0) {
        const zoomedWidth = textWidth * zoomedScale;
        const maxWidth = Math.max(0, width - 20);

        if ((textWidth >= maxWidth) || (zoomedWidth >= maxWidth)) {
          zoomedScale = maxWidth / textWidth;
          scale = zoomedScale / 1.12;
        }
      }
    }

    const far = (index === nextLine)
      ? (props.lyrics!.timeline[nextLine].far ?? true)
      : false;

    const storeRef = (index: number) => (lineRef: Line | null) => {
      if (lineRefs.current) {
        lineRefs.current[index] = lineRef;
      }
    }

    return (
      <Line
        key={index}
        ref={storeRef(index)}
        colors={colors.line}
        scale={scale}
        zoomedScale={zoomedScale}
        dim={index < line}
        active={line === index}
        zoom={line === index}
        far={far}
        lineHeight={props.lineHeight}
      >
        {lyricLine.text}
      </Line>
    );
  }

  // Render

  return (
    <>
      <Container background={colors.background}>
        <Ticker
          ref={tickerRef}
          lines={props.lines}
          lineHeight={props.lineHeight}
          beatInterval={beatInterval}
          position={position}
        >
          {props.lyrics?.timeline?.map(mapLine)}
        </Ticker>
      </Container>
    </>
  );
}
