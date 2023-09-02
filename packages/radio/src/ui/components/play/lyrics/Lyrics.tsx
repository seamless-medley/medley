import React from 'react';
import { Line, Container, Ticker, LineColors } from './elements';
import { LyricLine, Lyrics as CoreLyrics } from '@seamless-medley/core';
import { clamp, debounce, findIndex } from 'lodash';
// import type { TrackInfo, LyricLine } from 'common/types';

interface Colors {
  background: string;
  line: LineColors;
}

interface Props {
  lines: number;
  lineHeight: number;
  // trackInfo: TrackInfo | undefined;
  lyrics: CoreLyrics | undefined;
  colors: Colors | undefined;
  bpm?: number;
  // latencyCompensation?: number;

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

export class Lyrics extends React.Component<Props, { line: number }> {
  private raf = 0;
  private lastTick = Date.now();
  // private position = 0;
  private lineElements: Line[] = [];
  private tickerEl = React.createRef<Ticker>();

  state = {
    line: -1
  }

  private animate() {
    this.raf = requestAnimationFrame(() => {
      const now = Date.now();
      const delta = now - this.lastTick;
      //
      // this.position += delta;
      // this.lastTick = now;
      this.updateLine();
      this.animate();
    });
  }

  private resizeHandler = debounce(() => {
    if (this.tickerEl.current) {
      const y = this.getPosition(this.state.line);
      this.tickerEl.current.setPosition(y);
    }
  }, 1000);

  componentDidMount() {
    this.animate();
    window.addEventListener('resize', this.resizeHandler);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.resizeHandler);
    cancelAnimationFrame(this.raf);
  }

  componentDidUpdate(prev: Props) {
    const { lyrics, position } = this.props;

    if (prev.lyrics !== lyrics) {
      const timeline = lyrics?.timeline ?? [];

      // this.position = position;

      this.lastTick = Date.now();
      this.lineElements = Array(timeline.length).fill(0);
      this.setState({ line: -1 });
      this.updateLine();
    }
  }

  private updateLine() {
    const latencyCompensation = 0;
    const { lyrics, bpm = 90 } = this.props;

    if (!lyrics) {
      return;
    }

    const { line } = this.state;

    let foundLine = line;
    let newLine = null;

    while (newLine !== foundLine) {
      newLine = foundLine;

      let i = (foundLine + 1) || 0;
      while (i < lyrics.timeline?.length) {
        let { time } = lyrics.timeline[i];

        if (time !== undefined && time <= this.props.position + latencyCompensation) {
          foundLine = i;
          break;
        }

        i++;
      }
    }

    if (foundLine !== line) {
      this.setState({
        line: foundLine
      });
    }

    const nextLine = findIndex(lyrics.timeline, ({ text }) => text.trim().length > 0, foundLine + 1);

    if (nextLine !== -1 && nextLine !== foundLine) {
      const { time, far } = lyrics.timeline[nextLine];
      const beatTimestamp = time - (8 * (6e4 / bpm));

      if (far) {
        const realPosition = this.props.position + latencyCompensation;
        const el = this.lineElements[nextLine];
        if (el && realPosition >= beatTimestamp) {
          el.setProgress(clamp((time - realPosition) / (time - beatTimestamp), 0, 1));
        }
      }
    }
  }

  private storeLine(el: Line | null, index: number) {
    if (el && this.lineElements[index] !== el) {
      this.lineElements[index] = el;
    }
  }

  private getTopLine(line: number) {
    return Math.max(0, line - (this.props.lines / 2) + 1);
  }

  private calculatePosition(line: number) {
    const heights = Math.floor(window.innerHeight / this.props.lines);
    return line * heights;
  }

  private getPosition(index: number) {
    const heights = Math.floor(window.innerHeight / this.props.lines);

    const stickyLine = this.props.lines / 2 - 1;

    if (index < stickyLine) {
      return -heights * (stickyLine - index);
    }

    const topLine = this.getTopLine(index);

    const el = this.lineElements[topLine];
    return (el && el.top) || this.calculatePosition(topLine);
  }

  render() {
    const {
      lyrics,
      lineHeight,
      lines,
      // bpm = 90
    } = this.props;

    const { line } = this.state;

    const colors = this.props.colors || defaultColors;

    const mapLine = (lyricLine: LyricLine, i: number) => {
      const { text, far = false } = lyricLine;

      return (
        <Line
          colors={colors.line}
          key={i}
          ref={el => this.storeLine(el, i)}
          dim={i < line}
          active={line === i}
          zoom={line === i}
          far={far}
          {...{ lineHeight }}
        >
          {text}
        </Line>
      );
    }

    return (
      <Container
        background={colors.background}
      >
        <Ticker
          ref={this.tickerEl}
          position={this.getPosition(line)}
          {...{ lineHeight, lines }}
        >
          {lyrics?.timeline?.map(mapLine)}
        </Ticker>
      </Container>
    );
  }
}

