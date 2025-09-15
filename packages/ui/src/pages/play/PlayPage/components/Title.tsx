import { styled } from "@linaria/react";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import _, { debounce } from 'lodash';
import clsx from "clsx";

const TitleContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(0, 0);
  opacity: 0;

  z-index: 30;

  transition:
    opacity 0.6s ease,
    top 0.6s ease 0.6s,
    left 0.6s ease 0s,
    transform 0.6s ease 0s,
    ;

  &.visible {
    opacity: 1;
  }

  &.center {
    top: calc(50% - 1.6em);
    left: 50%;
    transform: translate(-50%, 0);

    transition:
      opacity 0.6s ease,
      top 0.6s ease 0s,
      left 0.6s ease 0.6s,
      transform 0.6s ease 0.6s,
    ;
  }
`;

const TitleBox = styled.div`
  padding: 0.12em 0.6em 0.12em 0.33em;
  border-radius: 0px 0px 0.25em 0px;
  background-color: rgba(200, 200, 255, 0.3);
  transition: all 0.2s ease, border-radius 0.6s ease;
  white-space: nowrap;
  min-height: 1.6em;

  &.center {
    border-radius: 0.25em;
  }
`;

const TitleText = styled.div`
  background-size: 300cqw 25cqw;

  animation: bg 18s infinite alternate linear;

  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  line-height: 1.6em;
  user-select: none;

  transform: translateX(0px) translateZ(0) rotateZ(360deg);

  transition: transform 1s linear;

  @keyframes bg {
    0% { background-position: 0% 0%; }
    10% { background-position: 0% 0%; }
    90% { background-position: 100% 100%; }
    100% { background-position: 100% 100%; }
  }
`;

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
    <TitleContainer className={clsx(props.center && 'center', props.visible && 'visible')}>
      <TitleBox ref={boxEl} className={clsx(props.center && 'center')}>
        <canvas ref={canvasEl} style={{ display: 'none' }} width={500} height={500} />
        <TitleText ref={textEl} />
      </TitleBox>
    </TitleContainer>
  );
}
