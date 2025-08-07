import { isFunction } from "lodash";
import { ComponentRef, ComponentType, forwardRef } from "react";

type Defaultize<P extends {}, Q extends Partial<P>> = Omit<P, keyof Q> &
  Partial<Pick<P, keyof Q & keyof P>>;

export function attrs<P extends {}, Q extends Partial<P>>(
  propsFactory: Q | ((props: Defaultize<P, Q>) => Q),
  Component: ComponentType<P>
) {
  return forwardRef<ComponentRef<ComponentType<P>>, Defaultize<P, Q>>(
    (props, ref) => {
      return (
        <Component
          {...(props as P)}
          {...(isFunction(propsFactory)
            ? propsFactory(props)
            : propsFactory)}
          ref={ref}
        />
      );
    }
  );
}
