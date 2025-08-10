import React, { RefObject, CSSProperties, PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { linearGradient, rgba, setSaturation, parseToHsl } from 'polished';
import { styled } from '@linaria/react';
import { clamp, findIndex, findLastIndex } from 'lodash';

import type { LyricLine, Timeline, EnhancedLine } from '@seamless-medley/utils';
import { type EnhancedLineElement, interpolate, findLyricLine } from '@seamless-medley/utils';
import type { DeckIndex } from '@seamless-medley/medley';
import { useElementSize } from '@mantine/hooks';

import { attrs } from '@ui/utils/attrs';
import { useDeck, useDeckInfo } from '@ui/hooks/useDeck';
import { client } from '@ui/init';

export type BackgroundProp = {
  background: string;
}

export type LineColors = {
  text: string;
  active: string;
  shadow: string;
  glow: string;
  dim: string;
}

export type LineTextProps = {
  lineIndex: number;
  active: boolean;
  lineHeight: number;
  zoom: boolean;
  dim: boolean;
  far: boolean;
  colors: LineColors;
  karaoke?: boolean;
}

export type LineLayoutProps = {
  lines: number;
  lineHeight: number;
}

export type PositionProps = {
  position: number;
}

export type BeatProps = {
  beatInterval?: number;
}

export const InnerContainer = styled.div<BackgroundProp>`
  position: relative;
  height: 100%;
  overflow: hidden;
  transition: background-color 1s ease;
  will-change: background-color;
  transform: translateZ(0) rotateZ(360deg);
  z-index: 0;
  opacity: 0.99;
`;

const Decorator = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  height: calc(1.8em * 4);
  pointer-events: none;
  z-index: 2;
`;

const TopDecorator = attrs(props => {
  return ({
    style: {
      background: linearGradient({
        toDirection: 'to top',
        colorStops: [rgba(props.background!, 0), props.background!]
      }).backgroundImage.toString()
    }
  });

}, styled(Decorator)<BackgroundProp>`
  top: 0;
`);

const BottomDecorator = attrs(props => {
  return ({
    style: {
      background: linearGradient({
        toDirection: 'to bottom',
        colorStops: [rgba(props.background!, 0), props.background!]
      }).backgroundImage.toString()
    }
  });
}, styled(Decorator)<BackgroundProp>`
  bottom: 0;
`);

export const Container: React.FC<PropsWithChildren<BackgroundProp>> = (props) => {
  const { background } = props;
  const p = { background };

  return (
    <InnerContainer {...p} style={{ width: '100%', background }}>
      <TopDecorator {...p}/>
      { props.children }
      <BottomDecorator {...p}/>
    </InnerContainer>
  )
}
const TickerContainer: React.FC<PropsWithChildren<LineLayoutProps & BeatProps>> = (props) => {
  const { ref, height } = useElementSize();

  const fontSize = height / (props.lines * props.lineHeight);
  const beatInterval = ((props.beatInterval ?? 0.66)).toFixed(2);

  return (
    <div ref={ref} style={{ fontSize, height: '100%', '--beat-interval': `${beatInterval}ms` } as CSSProperties}>
      {props.children}
    </div>
  )
}

const TickerScroller = attrs(props => {
  const { position } = props;

  return ({
    className: classNames({ smooth: position! > 0}),
    style: {
      transform: `translate3d(0px, ${-position!}px, 0px)`,
    }
  });
}, styled.div<PositionProps>`
  display: flex;
  flex-direction: column;
  height: 100%;
  text-align: center;
  white-space: nowrap;
  will-change: transform;

  transition: transform 0.75s ease-out;

  backface-visibility: hidden;
  perspective: 1000px;
`);

export const Ticker = React.forwardRef<HTMLDivElement, PropsWithChildren<LineLayoutProps & PositionProps & BeatProps>>(({ lineHeight, lines, position, children, beatInterval }, ref) => {
  return (
    <TickerContainer {...{ lines, lineHeight, beatInterval } }>
      <TickerScroller ref={ref} {...{ position }}>
        {children}
      </TickerScroller>

      <canvas style={{ display: 'none' }} />
    </TickerContainer>
  )
})

const LineText = attrs(props => {
  const { zoom, active, dim, karaoke } = props;

  const colors = props.colors!;

  const style: CSSProperties = {};

  if (active) {
    style.color = !karaoke ? colors.active : colors.text;
    style.textShadow = `0px 0px 0.3em ${colors.glow}, 0.025em 0.025em 0.013em ${colors.shadow}`;
  } else {
    style.textShadow = '';
    style.color = dim ? colors.dim : colors.text
  }

  return ({
    style,
    className: classNames({ zoom: zoom || active, dim })
  });

}, styled.div<LineTextProps>`
  display: flex;
  align-items: center;

  transition: color 0.3s ease, font-size 1s ease, transform 1s ease, text-shadow 0.6s ease;
  transform: scale(var(--scale)) translateZ(0) rotateZ(360deg);

  line-height: ${props => props.lineHeight}em;
  min-height: ${props => props.lineHeight}em;

  user-select: none;

  will-change: transform, font-size, color, text-shadow;
  backface-visibility: hidden;
  perspective: 1000px;

  font-size: 1em;

  &.zoom {
    transform: scale(var(--zoomedScale)) translateZ(0) rotateZ(360deg);
  }

  &.dim {
    opacity: 0.7;
  }
`);

type KaraokeTextOverlayProps = {
  active: boolean;
  lineHeight: number;
  color: string;
  strokeColor: string;
}

const KaraokeTextOverlay = attrs(props => {
  const { active } = props;

  return ({
    className: classNames({ active })
  });

}, styled.div<KaraokeTextOverlayProps>`
  position: absolute;

  visibility: hidden;

  display: flex;
  align-items: center;

  transition: color 0.3s ease, font-size 1s ease, transform 1s ease;
  transform: scale(var(--scale)) translateZ(0) rotateZ(360deg);

  line-height: ${props => props.lineHeight}em;
  min-height: ${props => props.lineHeight}em;

  user-select: none;

  will-change: transform, font-size, color, clip-path;
  backface-visibility: hidden;
  perspective: 1000px;

  color: ${props => props.color};
  text-shadow:
    -0.025em -0.025em ${props => props.strokeColor},
    0.025em 0.025em ${props => props.strokeColor},
    -0.025em 0.025em ${props => props.strokeColor},
    0.025em -0.025em ${props => props.strokeColor}
    ;

  font-size: 1em;

  &.active {
    visibility: visible;
    transform: scale(var(--zoomedScale)) translateZ(0) rotateZ(360deg);
  }

  clip-path: inset(0 100% 0 0);
`);

type IndicatorProps = {
  color: string;
}

const LineFarIndicator = attrs(props => {
  const style = {
    borderColor: `${props.color}`
  } as CSSProperties;

  return ({ style });

}, styled.div<IndicatorProps>`
  --size: 0.2em;

  position: absolute;
  width: var(--size);
  height: var(--size);

  left: calc(-2 * var(--size) - 0.2em);

  border-style: solid;
  border-width: var(--size);
  border-radius: 50%;

  animation: wobble var(--beat-interval) infinite reverse linear;

  opacity: 0;
  will-change: height, opacity, transform, animation-duration;

  transition: opacity 0.8s linear, border-color 0.5s linear;

  .dim {
    opacity: 0;
  }

  @keyframes wobble {
    from {
      transform: scale(1) translateZ(0) rotateZ(360deg);
    }

    to {
      transform: scale(1.2) translateZ(0) rotateZ(360deg);
    }
  }
`);

const LineWrapper = styled.div`
  position: relative;
  display: flex;
  flex-direction: row;
  justify-content: center;

  --scale: 1.0;
  --zoomedScale: 1.12;
`;

export type EnhancedLineElementInfo = EnhancedLineElement & {
  x: number;
}

type LineProps = LineTextProps & {
  scale: number;
  zoomedScale: number;
  tokens?: Array<EnhancedLineElementInfo>;
}

export class Line extends React.Component<PropsWithChildren<LineProps>> {
  private el = React.createRef<HTMLDivElement>();
  private farEl = React.createRef<HTMLDivElement>();
  private karaokeEl = React.createRef<HTMLDivElement>();

  #farProgress = 0;
  #karaokeTime = 0;

  get top() {
    if (!this.el.current) {
      return;
    }

    return this.el.current && this.el.current.offsetTop;
  }

  componentDidUpdate() {
    this.setFarProgress(this.#farProgress);
    this.setKaraokeTime(this.#karaokeTime);
  }

  setFarProgress(progress: number) {
    this.#farProgress = progress;

    if (this.farEl.current) {
      this.farEl.current.style.opacity = progress.toFixed(4);
    }
  }

  setKaraokeTime(time: number) {
    this.#karaokeTime = time;

    if (!this.karaokeEl.current) {
      return;
    }

    const { tokens } = this.props;

    if (!tokens?.length) {
      return;
    }

    const index = clamp(findLastIndex(tokens, info => time >= info.time), 0, tokens.length - 2);
    const [l, r] = [tokens[index], tokens[index + 1]];

    const minX = tokens[0].x;
    const maxX = tokens[tokens.length - 1].x;
    const width = maxX - minX;

    const x = interpolate(time, [l.time, r.time], [l.x, r.x]) - minX;
    const progress = clamp(x / width, 0, 1);

    this.karaokeEl.current.style.clipPath = `inset(0 ${(1-progress) * 100}% 0 0)`;
  }

  render() {
    const { scale, zoomedScale, tokens, ...textProps } = this.props;
    const { far, active, dim, colors } = textProps;

    const zoomAndScale = {
      '--scale': scale >= 0 ? scale : 0,
      '--zoomedScale': zoomedScale >= 0 ? zoomedScale : 0
    } as React.CSSProperties;


    return (
      <LineWrapper ref={this.el} style={{ ...zoomAndScale }}>
        <LineText {...textProps} karaoke={Boolean(tokens?.length)}>
          { far && (
              <LineFarIndicator
                ref={this.farEl}
                color={ active || dim ? colors.dim : colors.active}
              />
            )
          }
          {this.props.children}
        </LineText>

        {!!tokens?.length &&
          <KaraokeTextOverlay
            ref={this.karaokeEl}
            {...textProps}
            color={colors.active}
            strokeColor={setSaturation(parseToHsl(colors.active).saturation, colors.dim)}
          >
            {this.props.children}
          </KaraokeTextOverlay>
        }

      </LineWrapper>
    );

  }
}

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
    const ms = (cp - client.latency) * 1000;
    updateLine(ms);
    updateNextProgress(ms, nextLine);
  }, [deck, updateLine, updateNextProgress, nextLine]);

  // Intialization
  useEffect(() => {
    if (!deck) {
      return;
    }

    const ms = (deck.getProperties().cp - client.latency) * 1000;

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
