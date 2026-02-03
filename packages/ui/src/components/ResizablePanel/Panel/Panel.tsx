import { PropsWithChildren, RefObject, useContext, useEffect, useId, useMemo, useRef } from "react";
import { BoxComponentProps, Flex } from "@mantine/core";
import { PanelGroupContext } from "../PanelGroup/PanelGroup";
import classes from './Panel.module.css';
import clsx from "clsx";

export type PanelProps = {
  minSize: number;
  maxSize?: number;
  flexSize: number;
}

export type PanelData = {
  id: string;
  ref: RefObject<HTMLElement | null>;
  props: PanelProps;
}

export const Panel: React.FC<PropsWithChildren<BoxComponentProps & PanelProps>> = ({ children, ...boxProps }) => {
  const { minSize, maxSize, flexSize, className, style, ...rest } = boxProps as any;
  const props = { minSize, maxSize, flexSize } as PanelProps;

  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { registerPanel, unregisterPanel, isHorizontal } = useContext(PanelGroupContext);

  useEffect(() => {
    registerPanel(id, { id, ref, props });
    return () => unregisterPanel(id);
  }, [id, props, registerPanel, unregisterPanel]);

  const sizingProps = useMemo(() => ({
    [isHorizontal ? 'miw' : 'mih']: minSize,
    [isHorizontal ? 'maw' : 'mah']: maxSize,
  }), [isHorizontal]);

  return (
    <Flex
      className={clsx(classes.panel, className)}
      data-panel-id={id}
      ref={ref}
      {...sizingProps}
      style={{ ...style, flexGrow: flexSize.toString() }}
      {...rest}
    >
      {children}
    </Flex>
  )
}
