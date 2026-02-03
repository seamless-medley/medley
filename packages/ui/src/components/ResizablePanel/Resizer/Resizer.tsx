import { RefCallback, useCallback, useContext, useEffect, useRef } from "react";
import { PanelGroupContext } from "../PanelGroup/PanelGroup";
import { PanelData } from "../Panel/Panel";
import { clamp } from "lodash";
import clsx from "clsx";
import classes from './Resizer.module.css'

export const Resizer: React.FC = () => {
  const { panels, isHorizontal } = useContext(PanelGroupContext);

  const nodeRef = useRef<HTMLElement | null>(null);
  const listnerRefs = useRef<Record<string, Function>>({});

  type State = {
    pointer: number;
    pointerId: number;
    size: {
      prev: number;
      next: number;
    }
  }

  const startState = useRef<State>({ pointer: 0, pointerId: 0, size: { prev: 0, next: 0 } });

  type AdjacentPanel = { prev?: PanelData; next?: PanelData };
  const adjacentRef = useRef<AdjacentPanel | null>(null);

  const getAdjacentPanels  = useCallback(() => {
    if (adjacentRef.current) return adjacentRef.current;

    if (!nodeRef.current) return ({ prev: undefined, next: undefined })

    const prevEl = nodeRef.current.previousElementSibling;
    const prevId = prevEl?.getAttribute('data-panel-id');
    const prev = prevId ? panels.get(prevId) : undefined;

    const nextEl = nodeRef.current.nextElementSibling;
    const nextId = nextEl?.getAttribute('data-panel-id');
    const next = nextId ? panels.get(nextId) : undefined;

    adjacentRef.current = {
      prev,
      next
    }

    return adjacentRef.current;
  }, [panels]);

  const subscribe = useCallback(<K extends keyof HTMLElementEventMap>(type: K, listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any) => {
    if (!nodeRef.current) return;

    nodeRef.current.addEventListener(type, listener);
    listnerRefs.current[type] = listener;
  }, []);

  const unsubscribe = useCallback(<K extends keyof HTMLElementEventMap>(type: K) => {
    if (!nodeRef.current) return;

    nodeRef.current.removeEventListener(type, listnerRefs.current[type] as any);
    delete listnerRefs.current[type];
  }, []);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (startState.current.pointerId !== event.pointerId) return;

    const { prev, next } = getAdjacentPanels();
    if (!prev || !next) return;

    const position = isHorizontal ? event.clientX : event.clientY;
    const delta = position - startState.current.pointer;

    const totalSize = startState.current.size.prev + startState.current.size.next;
    const totalFlex = prev.props.flexSize + next.props.flexSize;

    const minSize = [prev.props.minSize, next.props.minSize];
    const maxSize = [prev.props.maxSize ?? Number.MAX_SAFE_INTEGER, next.props.maxSize ?? Number.MAX_SAFE_INTEGER];

    const newSize = [
        clamp(startState.current.size.prev + delta,
          Math.max(minSize[0], totalSize - maxSize[1]),
          Math.min(maxSize[0], totalSize - minSize[1])
        ),
        clamp(startState.current.size.next - delta,
          Math.max(minSize[1], totalSize - maxSize[0]),
          Math.min(maxSize[1], totalSize - minSize[0])
        )
    ];

    const flex = newSize.map(s => s / totalSize * totalFlex);

    prev.ref.current!.style.flexGrow = flex[0].toString();
    next.ref.current!.style.flexGrow = flex[1].toString();
  }, []);

  const onPoinerUp = useCallback((event: PointerEvent) => {
    unsubscribe('pointermove');
    nodeRef.current?.releasePointerCapture(event.pointerId);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent) => {
    if (!event.isPrimary) return;
    if (event.buttons !== 1) return; // left button

    event.stopPropagation();
    event.stopImmediatePropagation();

    window.getSelection()?.removeAllRanges?.();

    const { prev, next } = getAdjacentPanels();

    const getSize = (el?: HTMLElement | null) => (isHorizontal ? el?.clientWidth : el?.clientHeight) ?? 0;

    startState.current = {
      pointerId: event.pointerId,
      pointer: isHorizontal ? event.clientX : event.clientY,
      size: {
        prev: getSize(prev?.ref?.current),
        next: getSize(next?.ref?.current),
      }
    }

    nodeRef.current!.setPointerCapture(event.pointerId);
    subscribe('pointermove', onPointerMove);
  }, [getAdjacentPanels]);

  const ref: RefCallback<HTMLElement | null>  = useCallback((node) => {
    if (!node) return;

    nodeRef.current = node;

    subscribe('pointerdown', onPointerDown);
    subscribe('pointerup', onPoinerUp);
  }, []);

  useEffect(() => {
    return () => {
        if (nodeRef.current && listnerRefs.current) {
          for (const [name, fn] of Object.entries(listnerRefs.current)) {
            nodeRef.current.removeEventListener(name, fn as any);

          }
        }
    }
  }, [])

  return (
    <div ref={ref} className={clsx(classes.resizer, isHorizontal ? classes.horizontal : classes.vertical)}></div>
  )
}
