declare module 'colorable-dominant' {
  export type ColorableDominantOptions = {
    minContrast?: number;
    threshold?: number;
  }

  export type ColorableDominantResult = {
    backgroundColor: `#${string}` | null;
    color: `#${string}` | null;
    alternativeColor: `#${string}` | null;
  }

  function colorableDominant(colors: (number | string)[], options?: ColorableDominantOptions): ColorableDominantResult;

  export default colorableDominant;
}