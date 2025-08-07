import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';

type RefOrElement = MutableRefObject<HTMLElement> | HTMLElement;

type Unsubscriber = () => void;

type Subscriber = (element: HTMLElement) => Unsubscriber;

type Size = {
  width: number;
  height: number;
}

type OnResize = (newSize: Size, entry: ResizeObserverEntry | undefined, entries: ResizeObserverEntry[]) => void;

export type UseResizeOptions = {
  onResize: OnResize;
  refOrElement: RefOrElement;
  observerOnly?: keyof Size;
  observeOnMount?: boolean;
}

class CC {
  static #resizeObserver: ResizeObserver;

  static readonly #subscribersByElement = new WeakMap<Element, Set<any>>;

  static get resizeObserver() {
    if (!this.#resizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => {

      });
    }

    return this.#resizeObserver;
  }

  static observeElement(el: HTMLElement) {
    if (!this.#subscribersByElement.has(el)) {
      this.resizeObserver.observe(el);
      this.#subscribersByElement.set(el, new Set);
    }

    return this.#subscribersByElement.get(el)!;
  }

  static releaseSubscribers(el: HTMLElement) {
    if (this.#subscribersByElement.get(el)?.size === 0) {
      this.resizeObserver.unobserve(el);
      this.#subscribersByElement.delete(el);
    }
  }
}

export function useResize(options: UseResizeOptions) {
  const onResize = useRef(options.onResize);
  const observeOnly = useRef(options.observerOnly);

  const size = useRef<Size>({
    width: -1,
    height: -1
  });

  const observe = useCallback<OnResize>((newSize, entry, entries) => {
    if (!onResize.current) {
      return;
    }

    const widthChanged = size.current.width !== newSize.width
    const heightChanged = size.current.height !== newSize.height;

    const shouldNotify = (!observeOnly.current && (widthChanged || heightChanged))
      || ("width" === observeOnly.current && widthChanged)
      || ("height" === observeOnly.current && heightChanged);


    if (shouldNotify) {
      onResize.current(newSize, entry, entries);
      size.current.width = newSize.width;
      size.current.height = newSize.height;
    }
  }, []);

  return ((refOrElement: RefOrElement, subscriber: Subscriber) => {
    let newRef: MutableRefObject<HTMLElement> | undefined = undefined;
    const newRefToUse = useRef<HTMLElement | undefined>(undefined);
    const elementToUse = useRef<HTMLElement | undefined>(undefined);

    const observing = useRef<RefOrElement | undefined>(undefined);
    const unsubscribe = useRef<Unsubscriber | undefined>(undefined);
    const subscriberRef = useRef(subscriber);

    const update = useCallback(() => {
      let el: HTMLElement | undefined = undefined;

      if (elementToUse.current) {
        el = elementToUse.current
      } else if (newRefToUse.current) {
        el = newRefToUse.current;
      } else if (refOrElement instanceof HTMLElement) {
        el = refOrElement;
      }

      if (observing.current !== el) {
        if (unsubscribe.current) {
          unsubscribe.current();
          unsubscribe.current = undefined;
        }

        observing.current = el;

        if (el && subscriberRef.current) {
          unsubscribe.current = subscriberRef.current(el);
        }
      }

    }, [refOrElement]);

    const setElement = useCallback((el: HTMLElement) => {
      elementToUse.current = el;
      update()
    }, [update]);

    if (refOrElement && !(refOrElement instanceof HTMLElement)) {
      newRef = refOrElement;
    }

    useLayoutEffect(() => {
      if (newRef) {
        newRefToUse.current = newRef.current;
      }

      update();
    }, [newRef, newRef?.current, update]);

    // Unsubscribe on unmounted
    useEffect(() => () => {
      unsubscribe.current?.call(unsubscribe);
    }, []);

    return setElement;
  })(
    options.refOrElement,
    (element: HTMLElement) => {
      if (options.observeOnMount) {

        observe({
          width: element.offsetWidth,
          height: element.offsetHeight
        }, undefined, []);
      }

      const subscribers = CC.observeElement(element);
      subscribers.add(observe);

      // the Unobserve function
      return () => {
        subscribers.delete(observe);
        CC.releaseSubscribers(element)
      }
    }
  );
}
