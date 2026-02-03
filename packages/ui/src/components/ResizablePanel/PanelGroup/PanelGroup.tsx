import { createContext, PropsWithChildren, useCallback, useMemo, useRef } from "react";
import { BoxComponentProps, Flex } from "@mantine/core";
import { PanelData } from "../Panel/Panel";
import classes from './PanelGroup.module.css';
import clsx from "clsx";

type Orientation = 'horizontal' | 'vertical';

export type PanelGroupProps = {
  orientation: Orientation;
}

export type PanelContextValue = {
  isHorizontal: boolean;
  panels: Map<string, PanelData>;
  registerPanel: (id: string, data: PanelData) => void;
  unregisterPanel: (id: string) => void;
}

export const PanelGroupContext = createContext<PanelContextValue>(null!);

export const PanelGroup: React.FC<PropsWithChildren<BoxComponentProps & PanelGroupProps>> = ({ children, orientation, className }) => {
  const panelsRef = useRef(new Map<string, PanelData>());

  const registerPanel = useCallback((id: string, data: PanelData) => {
    panelsRef.current.set(id, data);
  }, []);

  const unregisterPanel = useCallback((id: string) => {
    panelsRef.current.delete(id);
  }, []);

  const isHorizontal = orientation === 'horizontal';

  const contextValue = useMemo<PanelContextValue>(() => ({
    isHorizontal: orientation === 'horizontal',
    panels: panelsRef.current,
    registerPanel,
    unregisterPanel
  }), [orientation, registerPanel, unregisterPanel]);

  return (
    <PanelGroupContext.Provider value={contextValue}>
      <Flex className={clsx(className, classes.panelGroup, isHorizontal ? classes.horizontal : classes.vertical)}>
        {children}
      </Flex>
    </PanelGroupContext.Provider>
  )
}
