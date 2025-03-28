import { styled } from "@linaria/react";
import React, { PropsWithChildren, useCallback, useEffect, useRef } from "react";

const Container = styled.div`
  overflow: hidden;
  position: relative;
  --end-gradient-width: 0.5em;

  &.gradient {
    mask-image: linear-gradient(to right, transparent 0, #000 var(--end-gradient-width), #000 calc(100% - var(--end-gradient-width)),transparent 100%);
  }

  &.gradient-left {
    mask-image: linear-gradient(to right, transparent 0, #000 var(--end-gradient-width));
  }

  &.gradient-right {
    mask-image: linear-gradient(to left, transparent 0, #000 var(--end-gradient-width));
  }
`;

const Scroller = styled.div`
  --trans-x: 0px;
  display: flex;
  transform: translateX(var(--trans-x));
  white-space: nowrap;
  width: fit-content;
`;

export type AutoScrollerProps = PropsWithChildren<{
  title?: string;
  speed?: number;
  pauseAtEndEdgeDurationMs?: number;
  startAnimationOnMountDelayMs?: number;
}>;

export const AutoScroller: React.FC<AutoScrollerProps> = (props) => {
  const {
    speed = 0.2,
    pauseAtEndEdgeDurationMs = 2000,
    startAnimationOnMountDelayMs = 1000,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const clipperRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const timer = useRef<number>();
  const animationFrame = useRef(0);

  const calcOverflowSize = React.useCallback(() => {
    return scrollerRef.current && containerRef.current
      ? scrollerRef.current.clientWidth - containerRef.current.clientWidth
      : 0
  }, []);

  const setGradient = useCallback((mode: 'left' | 'right' | 'both' | undefined) => {
    const [l, r, b] = ({
      left:   [true,    false,  false],
      right:  [false,   true,   false],
      both:   [false,   false,  true],
      none:   [false,   false,  false]
    })[mode ?? 'none'];

    containerRef.current?.classList.toggle('gradient-left', l);
    containerRef.current?.classList.toggle('gradient-right', r);
    containerRef.current?.classList.toggle('gradient', b);
  }, []);

  const startAnimation = useCallback(() => {
    let lastRafTimestamp = 0;
    let scrollAmount = 0;
    let endEdgeTimestamp = 0;
    let animationDirection = 1;

    const rafHandler: FrameRequestCallback = (time) => {
      const overflowSize = calcOverflowSize();

      if (overflowSize > 0) {
        let newScrollAmount = scrollAmount;

        if (lastRafTimestamp) {
          if (!endEdgeTimestamp) {
            // 60 pixels per second at 100% speed
            newScrollAmount += animationDirection * (60 * (time - lastRafTimestamp) / 1000) * speed;

            if (newScrollAmount > overflowSize) {
              // scrolled to the right most
              animationDirection = -animationDirection;
              endEdgeTimestamp = time;

              newScrollAmount = overflowSize; // clamp
            } else if (newScrollAmount < 0) {
              // scrolled to the left most
              animationDirection = -animationDirection;
              endEdgeTimestamp = time;

              newScrollAmount = 0; // clamp
            }
          } else {
            if (time > endEdgeTimestamp + pauseAtEndEdgeDurationMs) {
              endEdgeTimestamp = 0
            }
          }

          if (newScrollAmount !== scrollAmount) {
            scrollAmount = newScrollAmount;
          }

          setGradient(
            scrollAmount > 0 && scrollAmount < overflowSize
              ? 'both'
              : scrollAmount === 0
                ? 'right'
                : 'left'
          );

          const translate = -scrollAmount;

          scrollerRef.current?.style.setProperty("--trans-x", `${translate}px`);

          if (clipperRef.current) {
            clipperRef.current.scrollLeft = 0;
          }
        }
      } else {
        setGradient(undefined);
        scrollerRef.current?.style.setProperty("--trans-x", '0px');
      }

      lastRafTimestamp = time;
      animationFrame.current = requestAnimationFrame(rafHandler);
    }

    rafHandler(0);
  }, [calcOverflowSize, speed, pauseAtEndEdgeDurationMs, setGradient]);

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(animationFrame.current);
    animationFrame.current = 0;

    if (timer.current) {
      clearTimeout(timer.current);
    }

    if (scrollerRef.current) {
      scrollerRef.current?.style.setProperty("--trans-x", `0px`);
    }

    setGradient(undefined);
  }, []);

  useEffect(() => {
    stopAnimation();
    timer.current = setTimeout(startAnimation, startAnimationOnMountDelayMs) as unknown as number;
  }, [scrollerRef.current, props.children, startAnimation, startAnimationOnMountDelayMs]);

  // Handle unmount
  useEffect(() => {
    return function unmount() {
      stopAnimation();
      // updateTranslation();
    }
  }, []);

  console.log(scrollerRef.current?.style.getPropertyValue('--trans-x'));

  return (
    <Container ref={containerRef} title={props.title}>
      <div ref={clipperRef} style={{ overflow: 'hidden' }}>
        <Scroller ref={scrollerRef}>
          {props.children}
        </Scroller>
      </div>
    </Container>
  )
}
