import React, { CSSProperties, PropsWithChildren, useEffect, useRef, useState } from "react";
import { Text, TextProps } from "@mantine/core";
import { useSpring, useTransition, animated, SpringConfig } from '@react-spring/web';
import { AutoScroller } from "@ui/components/AutoScoller";

type TransitionTextProps = PropsWithChildren<Omit<TextProps, 'style'>> & {
  className?: string;
  delay?: number;
  direction?: 'up' | 'down';
  inline?: boolean;
  nowrap?: boolean;
  springConfig?: SpringConfig;
  translateValue?: string;
  style?: CSSProperties;
  autoscroll?: boolean;
}

export const TransitionText: React.FC<TransitionTextProps> = React.memo((props) => {
  const {
    children,
    direction,
    translateValue: tv = '100%',
    inline,
    nowrap,
    style,
    delay,
    springConfig,
    autoscroll,
    className,
    ...textProps
  } = props;

  const display =  inline ? 'inline-flex' : 'flex';
  const initialRun = useRef(true);
  const fromTransform = direction === 'down' ? `-${tv}` : tv;
  const leaveTransform = direction === 'down' ? tv : `-${tv}`;

  const transitions = useTransition([children], {
    enter: { opacity: 1, transform: 'translateY(0%)' },
    from: { opacity: 0, transform: `translateY(${fromTransform})` },
    leave: {
      opacity: 0,
      transform: `translateY(${leaveTransform})`,
      position: 'absolute',
      width: autoscroll ? 'calc(100% - 2em)' : undefined,
      overflow: autoscroll ? 'hidden' : undefined
    },
    config: springConfig,
    immediate: initialRun.current,
    delay: !initialRun.current ? delay : undefined
  });

  const [width, setWidth] = useState<number>(0);
  const currentRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef<number | string>('auto');

  useEffect(() => {
    initialRun.current = false;
    const element = currentRef.current;

    // If element doesn't exist, then do nothing
    if (!element) return;

    const { width, height } = element.getBoundingClientRect();

    setWidth(width);
    heightRef.current = height;
  }, [children, setWidth, currentRef]);

  const widthTransition = useSpring({
    to: { width },
    config: springConfig,
    immediate: initialRun.current,
    delay: !initialRun.current ? delay : undefined,

  });

  const transitionRenderer: Parameters<typeof transitions>[0] = (styles, item, state) => {
    const element = (
      <animated.div
        style={{ ...styles }}
        ref={item === children ? currentRef : undefined}
      >
        <Text {...textProps}>
          {item}
        </Text>
      </animated.div>
    );

    const shouldScroll = !inline && state.phase !== 'leave' && autoscroll;

    return shouldScroll
      ? <AutoScroller>{element}</AutoScroller>
      : element
  }

  return (
    <animated.div
      className={`text-transition ${className}`}
      style={{
        ...(inline && !nowrap && !initialRun.current ? widthTransition : undefined),
        ...style,
        whiteSpace: (inline || nowrap) ? 'nowrap' : 'normal',
        height: heightRef.current,
        display
      }}
    >
      {transitions(transitionRenderer)}
    </animated.div>
  )
});
