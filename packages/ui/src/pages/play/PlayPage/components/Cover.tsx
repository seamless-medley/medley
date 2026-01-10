import React, { forwardRef, PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { chain, first } from 'lodash';
import { rgba, transparentize } from "polished";
import clsx from 'clsx';
import classes from './Cover.module.css';

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

type CoverDisc = React.ComponentType & {

}

const CoverDisc = forwardRef<CoverDisc, PropsWithChildren<ColorsProp>>((props, ref) => {
  const [background, setBackground] = useState<string>();

  useEffect(() => {
    const pColors = props.colors || [];
    const colors = pColors.concat(first(pColors) || '').join(', ');
    const gradient = `conic-gradient(from var(--angle), ${colors})`;
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
    <div className={classes.disc} style={{ background }}>
      {props.children}
    </div>
  );
});

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
    if (center) {
      containerEl.current?.classList.add(classes.center);
    } else {
      containerEl.current?.classList.remove(classes.center);
    }
  }

  const hide = () => {
    containerEl.current?.classList.remove(classes.revealed);
  }

  const reveal = useCallback(() => {
    setDiscColors(colors);

    if (imageEl.current) {
      imageEl.current.classList.remove(classes.revealed);
      imageEl.current.src = url || '';
      imageEl.current.classList.add(classes.revealed);
    }

    containerEl.current?.classList.add(classes.revealed);
  }, [colors, url, imageEl.current]);

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
    const isCentered = containerEl.current?.classList.contains(classes.center) ?? false;

    const animate = visible && url
      ? ((isCentered && !center) ? centerThenReveal : revealThenCenter)
      : hide;

    animate();
  }, [center, url, colors, uuid, visible]);

  return (
    <>
      <div ref={containerEl} className={clsx(classes.container, classes.revealed, visible && classes.visible)}>
        <CoverDisc colors={discColors}>
          <img ref={imageEl}
            className={classes.image}
            style={{ opacity: url ? 0.85 : 0 }}
          />
          <div className={classes.decorator} />
        </CoverDisc>
      </div>
    </>
  )
}
