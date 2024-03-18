import React, { CSSProperties, PropsWithChildren } from 'react';
import classNames from 'classnames';
import { linearGradient, rgba } from 'polished';
import { attrs } from '../../../utils/attrs';
import { styled } from '@linaria/react';

interface BackgroundProp {
  background: string;
}

export interface LineColors {
  text: string;
  active: string;
  shadow: string;
  glow: string;
  dim: string;
}

interface LineProps {
  active: boolean;
  lineHeight: number;
  zoom: boolean;
  dim: boolean;
  far: boolean;
  colors: LineColors;
}

interface LineLayoutProps {
  lines: number;
  lineHeight: number;
}

interface PositionProps {
  position: number;
}

export interface Props extends LineLayoutProps, PositionProps {

};

export const InnerContainer = attrs(props => {
  return {
    style: {
      backgroundColor: props.background
    }
  }
}, styled.div<BackgroundProp>`
  position: relative;
  height: 100%;
  overflow: hidden;
  transition: background-color 1s ease;
  will-change: background-color;
  transform: translateZ(0) rotateZ(360deg);
  z-index: 0;
  opacity: 0.99;
`);

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
    <InnerContainer {...p}>
      <TopDecorator {...p}/>
      { props.children }
      <BottomDecorator {...p}/>
    </InnerContainer>
  )
}

const TickerContainer = styled.div<LineLayoutProps>`
  font-size: calc(min(80vw, 100vh) / (${props => props.lines} * ${props => props.lineHeight}));
`;

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
  text-align: center;
  white-space: nowrap;
  will-change: transform;

  transition: transform 0.75s ease-out;

  backface-visibility: hidden;
  perspective: 1000px;
`);

export class Ticker extends React.Component<PropsWithChildren<Props>> {
  private el = React.createRef<HTMLDivElement>();

  setPosition(position: number) {
    const el = this.el.current;
    if (el) {
      el.style.transform = `translate3d(0px, ${-position}px, 0px)`;
    }
  }

  render() {
    const { lines, lineHeight, position, children } = this.props;
    return (
      <TickerContainer {...{ lines, lineHeight } }>
        <TickerScroller ref={this.el} {...{ position }}>
          {children}
        </TickerScroller>

        <canvas style={{ display: 'none' }} />
      </TickerContainer>
    );
  }
}

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

}, styled.div<LineProps>`
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
    transform: scale(var(--zoomScale)) translateZ(0) rotateZ(360deg);
  }

  &.dim {
    opacity: 0.7;
  }
`);

interface IndicatorProps {
  color: string;
}

const LineFarIndicator = attrs(props => {
  const style: CSSProperties = {
    borderColor: `transparent transparent transparent ${props.color}`
  };

  return ({ style });

}, styled.div<IndicatorProps>`
  position: absolute;
  left: -0.75em;
  bottom: 0.6em;

  border-style: solid;
  border-width: 0.25em 0 0.25em 0.5em;

  animation: wobble 0.66s infinite alternate linear;

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
  --zoomScale: 1.12;
`;

export class Line extends React.Component<PropsWithChildren<LineProps>> {
  private el = React.createRef<HTMLDivElement>();
  private farEl = React.createRef<HTMLDivElement>();

  get top() {
    if (!this.el.current) {
      return;
    }

    return this.el.current && this.el.current.offsetTop;
  }

  private get canvas() {
    return this.el?.current?.parentElement?.parentElement?.querySelector('canvas');
  }

  private computeScales() {
    if (!this.el.current) {
      return;
    }

    const ctx = this.canvas?.getContext('2d');
    if (ctx) {
      ctx.font = window.getComputedStyle(this.el.current).font;

      let scale = 1;
      let zoomedScale = 1.12;

      const maxWidth = this.el.current.clientWidth - 20;

      const textWidth = ctx.measureText(this.props.children as string).width;
      const zoomedWidth = textWidth * zoomedScale;

      if ((textWidth >= maxWidth) || (zoomedWidth >= maxWidth)) {
        zoomedScale = maxWidth / textWidth;
        scale = zoomedScale / 1.12;
      }

      this.el.current.style.setProperty('--scale', `${scale}`);
      this.el.current.style.setProperty('--zoomScale', `${zoomedScale}`);
    }
  }

  setProgress(progress: number) {
    if (this.farEl.current) {
      this.farEl.current.style.opacity = `${progress}`;
    }
  }

  render() {
    this.computeScales();

    const { far, active, dim, colors } = this.props;
    return (
      <LineWrapper ref={this.el}>
        <LineText {...this.props}>
          { far && <LineFarIndicator ref={this.farEl}
            color={ active || dim ? colors.dim : colors.active}
          />}

          {this.props.children}
        </LineText>
      </LineWrapper>
    );
  }
}
