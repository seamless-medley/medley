import React, { CSSProperties, PropsWithChildren } from 'react';
import classNames from 'classnames';
import { linearGradient, rgba } from 'polished';
import { styled } from '@linaria/react';
import { useElementSize } from '@mantine/hooks';
import { attrs } from '../../../utils/attrs';

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
  active: boolean;
  lineHeight: number;
  zoom: boolean;
  dim: boolean;
  far: boolean;
  colors: LineColors;
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
  const { zoom, active, dim } = props;

  const colors = props.colors!;

  const style: CSSProperties = {};

  if (active) {
    style.color = colors.active;
    style.textShadow = `0px 0px 22px ${colors.glow}, 2px 2px 1px ${colors.shadow}`;
  } else {
    style.textShadow = '';
    style.color =  dim ? colors.dim : colors.text
  }

  return ({
    style,
    className: classNames({ zoom: zoom || active, dim })
  });

}, styled.div<LineTextProps>`
  display: flex;
  align-items: center;

  transition: color 0.3s ease, font-size 1s ease, transform 1s ease, text-shadow 1.5s ease;
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
  display: flex;
  flex-direction: row;
  justify-content: center;

  --scale: 1.0;
  --zoomedScale: 1.12;
`;

type LineProps = LineTextProps & {
  scale: number;
  zoomedScale: number
}

export class Line extends React.Component<PropsWithChildren<LineProps>> {
  private el = React.createRef<HTMLDivElement>();
  private farEl = React.createRef<HTMLDivElement>();

  get top() {
    if (!this.el.current) {
      return;
    }

    return this.el.current && this.el.current.offsetTop;
  }

  setProgress(progress: number) {
    if (this.farEl.current) {
      this.farEl.current.style.opacity = progress.toFixed(4);
    }
  }

  render() {
    const { scale, zoomedScale, ...textProps } = this.props;
    const { far, active, dim, colors } = textProps;

    const zoomAndScale = {
      '--scale': scale >= 0 ? scale : 0,
      '--zoomedScale': zoomedScale >= 0 ? zoomedScale : 0
    } as React.CSSProperties;


    return (
      <LineWrapper ref={this.el} style={{ ...zoomAndScale }}>
        <LineText {...textProps}>
          { far && (
              <LineFarIndicator
                ref={this.farEl}
                color={ active || dim ? colors.dim : colors.active}
              />
            )
          }

          {this.props.children}
        </LineText>
      </LineWrapper>
    );
  }
}
