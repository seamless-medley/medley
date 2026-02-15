import React from "react";
import { Box, BoxProps, Flex, FlexProps } from "@mantine/core";
import classes from './Panel.module.css';
import clsx from "clsx";

export type PanelHeaderOptions = BoxProps & {
  caption: string;
}

export type PanelProps = FlexProps & {
  orientation?: 'horizontal' | 'vertical';
  header?: string | PanelHeaderOptions;
  borders?: Partial<Record<'left' | 'top' | 'right' | 'bottom', boolean>>;
}

export const Panel: React.FC<PanelProps> = ({ className, children, direction = 'column', orientation, header, borders, w, h, miw, maw, mih, mah, flex, ...props }) => {
  const caption = typeof header === 'string' ? header : header?.caption;
  const { caption: _, className: headerClassName, ...headerProps } = typeof header === 'object' ? header : {};

  const wh = {
    w: orientation !== 'vertical' ? `calc(${w} + 1lh)` : w,
    h: orientation === 'vertical' ? `calc(${h} + 1lh)` : h
  }

  return (
    <Flex
      className={classes.panel}
      data-orientation={orientation}
      data-border-left={borders?.left}
      data-border-top={borders?.top}
      data-border-right={borders?.right}
      data-border-bottom={borders?.bottom}
      {...{ ...wh, miw, maw, mih, mah, flex }}
    >
      {header &&
        <Box className={clsx(classes.header, headerClassName)} {...headerProps}>
          {caption}
        </Box>
      }
      <Flex className={clsx(classes.content, className)} direction={direction} {...props} w={w?.toString()?.replace('%', 'cqw')} h={h}>
        {children}
      </Flex>
    </Flex>
  )
}
