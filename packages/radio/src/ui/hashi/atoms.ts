import { atom, WritableAtom } from 'jotai';

export const count = atom(0);
export const country = atom('Japan');
export const cities = atom(['Tokyo', 'Kyoto', 'Osaka']);
export const manga = atom({ 'Dragon Ball': 1984, 'One Piece': 1997, Naruto: 1999 });

// export function deepAtomPath<V>(record: DeepRecord, path: string): WritableAtom<V, V> {
//   const nu = atom(record.get(path));

//   return atom<V, V>(
//     (get) => {
//       return get(nu);
//     },
//     (_get, set, value) => {
//       set(nu, value);
//       record.set(path, value as any);
//     }
//   );
// }

export function entangle<V>(initial: V) {
  const nu = atom(initial);

  return atom<V, V>(
    (get) => {
      console.log('Getting value from universe');
      return get(nu);
    },
    (_get, set, value) => {
      console.log('Setting value to universe');
      set(nu, value);
    }
  )
}
