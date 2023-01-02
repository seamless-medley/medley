import { useEffect, useState } from "react";
import { $AnyProp, type PickProp, type Remotable } from "../../socket/types";

export function useRemotableProp<
  T extends { [key: string]: any },
  P extends keyof PickProp<T>
>(
  r: Remotable<T> | undefined,
  prop: P
): T[P] | undefined {
  const [value, set] = useState<T[P]>();

  useEffect(
    () => {
      if (r) {
        set(r.getProperties()[prop]);
      }

      return r?.onPropertyChange(prop as any, (_, newValue) => set(newValue))
    },
    [r]
  );

  return value;
}

export function useRemotable<T>(r: Remotable<T> | undefined) {
  const [values, setValues] = useState(r?.getProperties());

  useEffect(
    () => {
      const update = () => {
        if (r) {
          setValues({ ...r.getProperties() })
        }
      }

      update();
      return r?.onPropertyChange($AnyProp, () => update())
    },
    [r]
  );

  return values;
}
