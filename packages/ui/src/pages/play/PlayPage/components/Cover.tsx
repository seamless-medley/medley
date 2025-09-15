import React, { forwardRef, PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { chain, first } from 'lodash';
import { rgba, transparentize } from "polished";
import { styled } from '@linaria/react';
import clsx from 'clsx';

const CoverContainer = styled.div`
  --size: min(22cqh, 22cqw);

  position: absolute;
  bottom: 0;
  left: 0;
  width: var(--size);
  height: var(--size);
  z-index: 30;
  opacity: 0;
  margin: 0.2em;

  transform: scale(1.4) rotateZ(360deg) rotate(-180deg);

  transition:
    opacity 0.5s ease,
    transform 1s cubic-bezier(.5,-0.72,.41,1.56),
    bottom 1s ease-in-out,
    left 1s ease-in-out,
    width 1s ease-in-out,
    height 1s ease-in-out;
  ;

  transform-origin: -12%;

  will-change: opacity, transform, bottom, left, width, height;

  &.visible {
    opacity: 0.88;
  }

  &.revealed {
    transform: scale(1) rotateZ(360deg) rotate(0deg);
  }

  &.center {
    --centered-size: calc(var(--size) * 1.6);

    bottom: calc((100% - var(--centered-size)) / 2);
    left: calc((100% - var(--centered-size)) / 2);
    width: var(--centered-size);
    height: var(--centered-size);

    transform-origin: -38%;
  }
`;

//#region backgrounds
function tracks(n: number, color: string) {
  const availSize = 65; // %
  const start = 30; // %
  const size = availSize / n;
  const variation = 3; // %
  const ridgeSize = 1; // %
  const ridgeColor = rgba(color,0.3);
  const ridgeBlur = 0.2; // %

  return chain(n).times().flatMap(i => {
    let p1 = start + ((i + 1) * size) + (Math.random() * variation);
    let p2 = p1 + ridgeSize;

    return [
      `transparent ${p1  - ridgeBlur}%`,
      `${ridgeColor} ${p1}%`,
      `${ridgeColor} ${p2}%`,
      `transparent ${p2  - ridgeBlur}%`
    ]
  }).join(', ');
}

function grooves(steps = 59, color: string = 'black') {
  const loopSize = 70;
  const stepSize = loopSize / steps;

  const variation = 0.3;
  const maxTransparency = 0.18;

  return chain(steps).times().flatMap(i => {
    const step = stepSize * (i + 1);
    let transparency = 1;
    let cur_variation = Math.random() * variation;

    transparency = transparency - cur_variation;
    if (i % 2 === 1) {
      transparency = 1 - transparency;
    }

    transparency = 1 - ((1 - transparency) * maxTransparency);

    return `${transparentize(transparency, color)} ${step}px`;
  }).value().join(', ');
}

const discAreas = (borderColor: string) => `radial-gradient(
  circle closest-side,
  ${transparentize(0.2, borderColor)} 43%,
  transparent 43.5%,
  transparent 96%,
  ${borderColor} 96.5%
)`;

const createTracks = (color: string) => `radial-gradient(circle closest-side, ${tracks(7, color)})`;

const highlights = `conic-gradient(
  black 40deg,
  white 42deg,
  black 44deg,
  black 219deg,

  white 222deg,
  white 22deg,
  black 229deg
)`;

const createGrooves = (color: string) => `repeating-radial-gradient(${grooves(59, color)})`;

const weakLightning = `conic-gradient(
  ${transparentize(1, 'white')} 80deg,
  ${transparentize(0.96, 'white')} 90deg,
  ${transparentize(1, 'white')} 95deg,
  ${transparentize(1, 'white')} 260deg,
  ${transparentize(0.96, 'white')} 270deg,
  ${transparentize(1, 'white')} 285deg
)`;

const strongLightning = `conic-gradient(
  ${transparentize(1,'white')},
  ${transparentize(0.78, 'white')} 20deg,
  ${transparentize(0.71, 'white')} 40deg,
  ${transparentize(1,'white')} 70deg,
  ${transparentize(1,'white')} 180deg,
  ${transparentize(0.82, 'white')} 200deg,
  ${transparentize(0.85, 'white')} 210deg,
  ${transparentize(1,'white')} 250deg
)`;
//#endregion

interface ColorsProp {
  colors: string[];
}

const CoverDiscElement = styled.div<ColorsProp>`
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 100%;

  background-blend-mode:normal,normal,color-dodge,normal,normal;

  animation: wiggle 30ms infinite;

  backface-visibility: hidden;
  perspective: 1000;

  will-change: transform;

  &::before {
    content:"";
    position:absolute;
    width:100%;
    height:100%;
    background:repeating-radial-gradient(${grooves()});
    border-radius:100%;
    animation: wabble 15s infinite alternate ease-in-out;
  }

  @keyframes wiggle {
    0% {
      transform: rotate(0);
    }
    100% {
      transform: rotate(0.5deg);
    }
  }

  @keyframes wabble {
    0% {
      opacity: 0.5;
      transform: scale(1.4);
    }
    50% {
      opacity: 0.8;
      transform: scale(1.2) rotate(180deg);
    }
    100% {
      opacity: 0.5;
      transform: scale(1) rotate(360deg);
    }
  }
`;

type CoverDisc = React.ComponentType & {

}

const CoverDisc = forwardRef<CoverDisc, PropsWithChildren<ColorsProp>>((props, ref) => {
  const [background, setBackground] = useState<string>();


  useEffect(() => {
    const pColors = props.colors || [];
    const colors = pColors.concat(first(pColors) || '').join(', ');
    const gradient = `conic-gradient(from 200deg, ${colors})`;
    const fColor = first(props.colors) || 'black';

    setBackground([
      discAreas(fColor),
      createTracks(fColor),
      highlights,
      createGrooves(fColor),
      weakLightning,
      strongLightning,
      gradient
    ].join(','));

  }, [props.colors]);

  return (
    <CoverDiscElement colors={props.colors} style={{ background }}>
      {props.children}
    </CoverDiscElement>
  );
});

const CoverImage = styled.img`
  position:absolute;
  top: 50%;
  left: 50%;
  width: 43%;
  height: 43%;
  margin-left: calc(-43% / 2);
  margin-top: calc(-43% / 2);
  border-radius: 100%;
  object-fit: contain;
  object-position: center;
  opacity: 0;
  user-select: none;
  border: none;

  will-change: opacity, transform;

  animation: spin 4s infinite linear;

  @keyframes spin {
    from {
      transform: rotate(0deg) translateZ(0) rotateZ(360deg);
    }

    to {
      transform: rotate(360deg) translateZ(0) rotateZ(360deg);
    }
  }

  &.visible {
    opacity: 1;
  }
`;

const CoverDecorator = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 43%;
  height: 43%;
  margin-left: calc(-43% / 2);
  margin-top: calc(-43% / 2);
  border-radius: 100%;
  background: radial-gradient(
    circle closest-side,
    rgba(0,0,0,0.8) 5%,
    transparent 5.5%,
    transparent 96%,
    rgba(255,255,255,0.5) 96.5%
  );
`;

export type CoverProps = {
  url?: string;
  colors: string[];
  center: boolean;
  uuid: string;
  visible?: boolean;
}

export const Cover: React.FC<CoverProps> = ({ center, url, colors, uuid, visible }) => {
  const containerEl = useRef<HTMLDivElement>(null);
  const imageEl = useRef<HTMLImageElement>(null);

  const [discColors, setDiscColors] = useState(colors);

  const updateCenter = () => {
    const c = 'center';

    if (center) {
      containerEl.current?.classList.add(c);
    } else {
      containerEl.current?.classList.remove(c);
    }
  }

  const hide = () => {
    containerEl.current?.classList.remove('revealed');
  }

  const reveal = useCallback(() => {
    setDiscColors(colors);

    if (imageEl.current) {
      imageEl.current.classList.remove('revealed');
      imageEl.current.src = url || '';

      imageEl.current.classList.add('revealed');
    }

    containerEl.current?.classList.add('revealed');
  }, [url]);

  const animationTimer = useRef<number>(null);

  const revealThenCenter = () => {
    hide();

    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }

    animationTimer.current = setTimeout(() => {
      reveal();
      setTimeout(updateCenter, 1e3);
    }, 1.1e3) as unknown as number;
  }

  const centerThenReveal = () => {
    updateCenter();

    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }

    animationTimer.current = setTimeout(() => {
      hide();
      setTimeout(reveal, 1.1e3);
    }, 1e3) as unknown as number;
  }

  useEffect(() => {
    const isCentered = containerEl.current?.classList.contains('center') ?? false;

    const animate = url
      ? ((isCentered && !center) ? centerThenReveal : revealThenCenter)
      : hide;

    animate();
  }, [center, url, colors, uuid]);

  return (
    <>
      <CoverContainer ref={containerEl} className={clsx('revealed', visible && 'visible')}>
        <CoverDisc colors={discColors}>
          <CoverImage ref={imageEl} style={{ opacity: url ? 0.77 : 0 }} />
          <CoverDecorator />
        </CoverDisc>
      </CoverContainer>
    </>
  )
}
