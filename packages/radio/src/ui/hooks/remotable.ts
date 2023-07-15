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

  const update = (newValue?: T[P]) => r && set(newValue ?? r.getProperties()[prop]);

  useEffect(() => {
    update();

    return r?.addPropertyChangeListener(prop, update);
  }, [r]);

  return value;
}

export function useRemotableProps<T extends { [key: string]: any }>(r: Remotable<T> | undefined) {
  const [values, setValues] = useState(r?.getProperties());

  const update = () => r && setValues({ ...r?.getProperties() });

  useEffect(() => {
    update();
    return r?.addPropertyChangeListener($AnyProp, update);
  }, [r]);

  return values;
}
