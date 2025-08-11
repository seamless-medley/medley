import React, { PropsWithChildren } from "react";
import { Text, TextProps } from "@mantine/core";
import TextTransition, { TextTransitionProps } from 'react-text-transition';

type TransitionTextProps = PropsWithChildren<TextProps & TextTransitionProps> & {
  component?: any;
};

export const TransitionText: React.FC<TransitionTextProps> = React.memo((props) => {
  const {
    children,
    direction, inline, delay, springConfig, style, translateValue,
    ...textProps
  } = props;

  const transitionProps = { direction, inline, delay, springConfig, style, translateValue };

  return (
    <TextTransition {...transitionProps}>
      <Text {...textProps}>
        {children}
      </Text>
    </TextTransition>
  )
});
