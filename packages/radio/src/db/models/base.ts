import { WithId } from '../schema/base';

export const $ActualObject = Symbol.for('$ActualObject');

type WithActualObject<T> = {
  [$ActualObject]: T;
}

export function createModel<R extends WithId>(name: string) {
  const Model = ({
    [name]: class {
      [$ActualObject]!: R;

      constructor(r: R) {
        this[$ActualObject] = r;

        return new Proxy(this, {
          get(target, p) {
            return (p in target) ? (target as any)[p] : r[p as keyof R];
          },

          set(target, p, value) {
            if (p in target) {
              (target as any)[p] = value;
              return true;
            }

            if (p in r) {
              r[p as keyof R]= value;
              return true;
            }

            return false;
          }
        });
      }
    }
  })[name];

  return Model as unknown as new (r: R) => R & WithActualObject<R>;
}
