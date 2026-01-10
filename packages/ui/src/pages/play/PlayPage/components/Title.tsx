import React, { useCallback, useEffect, useRef } from 'react';
import _, { debounce } from 'lodash';
import clsx from "clsx";
import { AutoScroller } from "@ui/components/AutoScoller";
import { Box } from "@mantine/core";
import classes from './Title.module.css';

export type TitleProps = {
  text: string;
  bg: string;
  center?: boolean;
  visible?: boolean;
}

export const Title: React.FC<TitleProps> = (props) => {
  const boxEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const textEl = useRef<HTMLDivElement>(null);

  const updateBounding = () => {
    if (!canvasEl.current || !boxEl.current) {
      return;
    }

    const ctx = canvasEl.current.getContext('2d')!;
    const font = window.getComputedStyle(canvasEl.current.parentElement!).font!;
    ctx.font = font;

    const boxStyle = window.getComputedStyle(boxEl.current);

    const tm = ctx.measureText(props.text);
    const tw = tm.width;

    boxEl.current.style.width = `clamp(0em, calc(${tw}px + ${boxStyle.paddingLeft} + ${boxStyle.paddingRight} + 0.1em), 100cqw)`;
  }

  const updateText = useCallback(() => {
    updateBounding();

    if (!textEl.current) {
      return;
    }

    textEl.current.innerText = '';

    setTimeout(() => {
      const el = textEl.current!;
      if (el) {
        el.style.backgroundImage = props.bg || "";
        el.innerText = props.text;
      }
      updateBounding();
    }, 700);
  }, [textEl.current, props.text, props.bg]);

  useEffect(() => {
    updateBounding();
    updateText();
  }, [props.text, props.bg]);

  const viewportUpdateHandler = useCallback(debounce(() => {
    updateBounding();
  }, 200), [canvasEl.current, props.text]);

  useEffect(() => {
    document.addEventListener('DOMContentLoaded', viewportUpdateHandler);
    window.addEventListener('load', viewportUpdateHandler);
    window.addEventListener('resize', viewportUpdateHandler);

    const timer = setInterval(viewportUpdateHandler, 5000);

    return () => {
      document.removeEventListener('DOMContentLoaded', viewportUpdateHandler);
      window.removeEventListener('load', viewportUpdateHandler);
      window.removeEventListener('resize', viewportUpdateHandler);
      clearTimeout(timer);
    }
  }, [props.text]);

  return (
    <div className={clsx(classes.container, props.center && classes.center, props.visible && classes.visible)}>
      <div ref={boxEl} className={clsx(classes.box, props.center && classes.center)}>
        <canvas ref={canvasEl} style={{ display: 'none' }} width={500} height={500} />
        <Box>
          <AutoScroller speed={0.8}>
            <div ref={textEl} className={classes.text} />
          </AutoScroller>
        </Box>
      </div>
    </div>
  );
}
