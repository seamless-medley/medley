import _, { debounce } from 'lodash';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBox, TitleText, TitleContainer } from './elements';

export type TitleProps = {
  text: string;
  bg: string;
}

export const Title: React.FC<TitleProps> = (props) => {
  const boxEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const textEl = useRef<HTMLDivElement>(null);

  const [text, setText] = useState(props.text);

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

    boxEl.current.style.width = `calc(${tw}px + ${boxStyle.paddingLeft} + ${boxStyle.paddingRight})`;
  }

  const updateText = () => {
    if (props.text === text) {
      return;
    }

    setText('');
    updateBounding();

    setTimeout(() => {
      const el = textEl.current!;
      el.style.backgroundImage = props.bg || "";
      setText(el.innerText = props.text);
      updateBounding();
    }, 700);
  }

  useEffect(() => {
    updateBounding();
    updateText();
  }, [props.text]);

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
    <TitleContainer>
      <TitleBox ref={boxEl}>
        <canvas ref={canvasEl} style={{ display: 'none' }} width={500} height={500} />
        <TitleText ref={textEl} />
      </TitleBox>
    </TitleContainer>
  );
}
