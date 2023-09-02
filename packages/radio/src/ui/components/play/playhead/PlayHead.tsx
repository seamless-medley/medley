import React, { createRef, PropsWithChildren, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { clamp } from "lodash";
import { Box, Container, Mask, Next, ProgressText } from "./elements";

interface Props {
  position: number;
  duration: number;

  next?: string;

  backgroundColor: string;
  textColor: string;
  activeColor: string;
}

function format(ms: number) {
  const seconds = ms / 1000;
  const mm = Math.trunc(seconds / 60);
  const ss = Math.trunc(seconds % 60);
  return [mm, ss].map(e => e.toString().padStart(2, '0')).join(':')
}

export const PlayHead: React.FC<PropsWithChildren<Props>> = (props) => {
  const containerEl = useRef<HTMLDivElement>(null);
  const maskEl = useRef<HTMLDivElement>(null);

  const { position, duration, next, backgroundColor, textColor } = props;

  const [nextTrack, setNextTrack] = useState(next);
  const [nextLoading, setNextLoading] = useState(false);

  useEffect(() => {
    if (maskEl.current) {
      const progress = position / duration;
      maskEl.current.style.left = `${progress * 100}%`;
    }
  }, [maskEl.current, position, duration]);

  const hideNextTimer = useRef<number>();

  useEffect(() => {
    clearTimeout(hideNextTimer.current);

    if (next) {
      setNextTrack(next);
      setNextLoading(true);
      return;
    }

    setNextLoading(false);
    hideNextTimer.current = setTimeout(() => {
      setNextTrack(undefined);
    }, 4000) as unknown as number;
  }, [next]);

  const text = format(position);
  const clockChars = text.split('').map((c, i) => <span key={i}>{c}</span>);
  const show = !!next;

  return (
    <>
      <Container ref={containerEl} className={classNames({ withNext: show })}>
        <Box>
          <ProgressText
            backgroundColor={backgroundColor}
            textColor={textColor}
          >
            {clockChars}
          </ProgressText>

          <Mask ref={maskEl} />
        </Box>
      </Container>

      <Next
        style={{ minWidth: `calc(${containerEl.current?.clientWidth ?? 0}px - 0.4em * 2)` }}
        color={props.activeColor}
        className={classNames({ show, loading: nextLoading })}
      >
        <span>{nextTrack && 'Next: '}{nextTrack}</span>
      </Next>
    </>
  )
}
