import React, { CSSProperties, PropsWithChildren } from "react";
import { Text, TextProps } from "@mantine/core";
import { AnimatePresence, motion, Transition } from 'motion/react';
import { AutoScroller } from "@ui/components/AutoScoller";

type TransitionTextProps = PropsWithChildren<Omit<TextProps, 'style'>> & {
  className?: string;
  transition?: Transition;
  direction?: 'up' | 'down';
  inline?: boolean;
  nowrap?: boolean;
  style?: CSSProperties;
  autoscroll?: boolean;
  stableId?: string;
}

export const TransitionText: React.FC<TransitionTextProps> = React.memo((props) => {
  const {
    children,
    direction,
    inline,
    nowrap,
    style,
    transition,
    autoscroll,
    className,
    stableId,
    ...textProps
  } = props;

  const display =  inline ? 'inline-flex' : 'flex';
  const tv = '100%';
  const fromTransform = direction === 'down' ? `-${tv}` : tv;
  const leaveTransform = direction === 'down' ? tv : `-${tv}`;

  const key = stableId ?? children?.toString();

  const text = (
    <Text {...textProps}>
      {children}
    </Text>
  );

  return (
    <motion.div className={className} style={style}>
      <AnimatePresence>
        <motion.div
          key={key}
          transition={{
            type: 'tween',
            ease: 'circInOut',
            ...transition
          }}
          initial={{ opacity: 0, translateY: fromTransform, position: 'relative' }}
          animate={{ opacity: 1, translateY: '0%' }}
          exit={{
            display,
            position: 'absolute',
            translateY: leaveTransform,
            opacity: 0,
            width: autoscroll ? '100%' : undefined,
            overflow: autoscroll ? 'hidden' : undefined
          }}
        >
            {autoscroll && !inline
              ? <AutoScroller>{text}</AutoScroller>
              : text
            }
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
});

