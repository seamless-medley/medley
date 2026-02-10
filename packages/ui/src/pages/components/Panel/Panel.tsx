import React from "react";
import { Box, BoxProps, Flex, FlexProps } from "@mantine/core";
import classes from './Panel.module.css';
import clsx from "clsx";

export type PanelHeaderOptions = BoxProps & {
  caption: string;
}

export type PanelProps = FlexProps & {
  header?: string | PanelHeaderOptions;
}

export const Panel: React.FC<PanelProps> = ({ className, children, direction = 'column', header, w, h, miw, maw, mih, mah, flex, ...props }) => {
  const caption = typeof header === 'string' ? header : header?.caption;
  const { caption: _, className: headerClassName, ...headerProps } = typeof header === 'object' ? header : {};

  return (
    <Flex className={classes.panel} {...{ w: `calc(${w} + 1lh)`, h, miw, maw, mih, mah, flex }}>
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
