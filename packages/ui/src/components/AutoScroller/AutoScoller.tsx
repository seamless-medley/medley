import React, { PropsWithChildren, useCallback, useEffect, useRef } from "react";
import classes from './AutoScroller.module.css';

export type AutoScrollerProps = PropsWithChildren<{
  title?: string;

  /**
   * Animation speed multiplier (default: 0.2)
   */
  speed?: number;

  /**
   * Pause duration at edges (default: 2000ms)
   */
  pauseAtEndEdgeDurationMs?: number;

  /**
   * Start delay (default: 1000ms)
   */
  startAnimationOnMountDelayMs?: number;

  stableId?: string;
}>;

/**
 * Automatically scrolls overflowing content horizontally with smooth bidirectional animation and gradient fade effects.
 */
export const AutoScroller: React.FC<AutoScrollerProps> = (props) => {
  const {
    speed = 0.4,
    pauseAtEndEdgeDurationMs = 2000,
    startAnimationOnMountDelayMs = 1500,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const clipperRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const timer = useRef<number>(undefined);
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

    const classList = containerRef.current?.classList;

    if (classList) {
      classList.toggle(classes.gradientLeft, l);
      classList.toggle(classes.gradientRight, r);
      classList.toggle(classes.gradient, b);
    }
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
        scrollAmount = 0;
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

    if (startAnimationOnMountDelayMs > 0) {
      const overflowSize = calcOverflowSize();

      if (overflowSize > 0) {
        setGradient('right');
      }
    }

    timer.current = setTimeout(startAnimation, startAnimationOnMountDelayMs) as unknown as number;
  }, [scrollerRef.current, props.stableId ?? props.children, startAnimation, startAnimationOnMountDelayMs]);

  // Handle unmount
  useEffect(() => stopAnimation, []);

  return (
    <div ref={containerRef} className={classes.container} title={props.title}>
      <div ref={scrollerRef} className={classes.scroller}>
        {props.children}
      </div>
    </div>
  )
}
