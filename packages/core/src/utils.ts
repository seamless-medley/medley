import { distance } from "fastest-levenshtein";

export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const editDistance = distance(a, b);
  const longestLength = Math.max(a.length, b.length);

  return (longestLength - editDistance) / longestLength
}
