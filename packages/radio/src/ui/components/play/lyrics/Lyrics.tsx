import React, { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clamp, findIndex } from 'lodash';
import type { LyricLine, Lyrics as CoreLyrics, Timeline, EnhancedLine } from '@seamless-medley/utils';
import { findLyricLine } from '@seamless-medley/utils';
import { DeckIndex } from '@seamless-medley/core';
import { useElementSize } from '@mantine/hooks';
import { useDeck, useDeckInfo } from '../../../hooks/useDeck';
import { Container, LineColors, Ticker, Line, EnhancedLineElementInfo } from './elements';
import { client } from '../../../init';

interface Colors {
  background: string;
  line: LineColors;
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

const findNextLine = (timeline: Timeline<string | EnhancedLine>, fromLine: number) => findIndex(timeline, ({ line }) => (typeof line === 'string' ? line : line?.map(e => e.token)?.join(''))?.trim().length > 0, fromLine + 1);

export type LyricsProps = {
  stationId?: string;
  deckIndex: DeckIndex;
  lines: number;
  lineHeight: number;
  colors: Colors | undefined;
}

export const Lyrics: React.FC<LyricsProps> = (props) => {
  const [line, setLine] = useState(-1);
  const { ref: tickerRef, width, height } = useElementSize<HTMLDivElement>();
  const lineRefs = useRef<(Line | null)[]>([]);
  const { deck } = useDeck(props.stationId, props.deckIndex);
  const { trackPlay } = useDeckInfo(props.stationId, props.deckIndex, 'trackPlay');

  const lyrics = trackPlay?.track?.extra?.coverAndLyrics?.lyrics;
  const bpm = trackPlay?.track?.extra?.tags?.bpm ?? 90;

  const canvas = useMemo(() => tickerRef.current?.parentElement?.querySelector('canvas'), [tickerRef.current]);
  const ctx = useMemo(() => canvas?.getContext('2d'), [canvas]);

  useEffect(() => {
    if (ctx) {
      ctx.font = window.getComputedStyle(tickerRef.current!).font;
    }
  });

  // Reset the line and re-render when lyrics changes
  useEffect(() => {
    setLine(-1);
  }, [lyrics]);

  // Reset the references to Line components when lyrics changes
  useEffect(() => {
    lineRefs.current = Array(lyrics?.timeline?.length ?? 0).fill(null);
  }, [lyrics]);

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
    if (!lyrics) {
      return -1;
    }

    const n = findNextLine(lyrics.timeline, line);
    return n !== line ? n : -1;

  }, [line, lyrics]);

  // function to advance the lyric line
  const updateLine = useCallback((ms: number) => {
    if (!lyrics) {
      return;
    }

    const foundLine = findLyricLine(lyrics.timeline, ms, line);

    if (foundLine > -1 && foundLine !== line) {
      setLine(foundLine);
    }

    if (lyrics?.type === 'enhanced' && foundLine !== -1) {
      const lineRef = lineRefs.current?.[foundLine];
      if (lineRef) {
        lineRef.setKaraokeTime(ms);
      }
    }

  }, [deck, lyrics]);

  const beatInterval = useMemo(() => 6e4 / bpm, [bpm])

  // function to update progress of the next line far indicator
  const updateNextProgress = useCallback((ms: number, line: number) => {
    if (!lyrics || line === -1) {
      return;
    }

    const { time, far } = lyrics.timeline[line];
    const lineRef = lineRefs.current?.[line];

    if (!far || !lineRef) {
      return;
    }

    const beatTimestamp = time - (8 * beatInterval);

    if (ms >= beatTimestamp) {
      const progress = clamp((time - ms) / (time - beatTimestamp), 0, 1);
      lineRef.setFarProgress(progress);
    }

  }, [lyrics]);

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

    if (lyrics?.timeline) {
      updateNextProgress(
        ms,
        findNextLine(lyrics.timeline, line)
      );
    }

    return deck.addPropertyChangeListener('cp', handleChange);
  }, [deck, handleChange]);

  const colors = props.colors || defaultColors;

  // function to create Line component for each lyrics line
  const mapLine = (lyricLine: LyricLine<string | EnhancedLine>, index: number) => {
    const karaoke = lyrics?.type === 'enhanced';

    const text = karaoke
      ? (lyricLine.line as EnhancedLine)?.map(e => e.token).join('')
      : lyricLine.line as string;

    // calculate scaling for each line
    let scale = 1;
    let zoomedScale = 1.12;

    const tokensInfo: Array<EnhancedLineElementInfo> = [];

    if (ctx) {
      if (karaoke) {
        const tokens = lyricLine.line as EnhancedLine;

        let acc = '';
        let lastX = 0;

        for (const token of tokens) {
          acc += token.token;

          tokensInfo.push({
            ...token,
            x: lastX
          });

          lastX = ctx.measureText(acc).width;
        }
      }

      const textWidth = ctx.measureText(text).width;

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
      ? (lyrics!.timeline[nextLine].far ?? true)
      : false;

    const storeRef = (index: number) => (lineRef: Line | null) => {
      if (lineRefs.current) {
        lineRefs.current[index] = lineRef;
      }
    }

    return (
      <Line
        key={index}
        lineIndex={index}
        ref={storeRef(index)}
        colors={colors.line}
        scale={scale}
        zoomedScale={zoomedScale}
        dim={index < line}
        active={line === index}
        zoom={line === index}
        far={far}
        lineHeight={props.lineHeight}
        tokens={tokensInfo}
      >
        {text}
      </Line>
    );
  }

  // Render

  return (
    <>
      <Container background={colors.background}>
        <Ticker
          ref={tickerRef as RefObject<HTMLDivElement> | undefined}
          lines={props.lines}
          lineHeight={props.lineHeight}
          beatInterval={beatInterval}
          position={position}
        >
          {lyrics?.timeline?.map(mapLine)}
        </Ticker>
      </Container>
    </>
  );
}
