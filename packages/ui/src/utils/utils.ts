import type { DeckIndex } from "@seamless-medley/medley";
import type { RgbColor } from "polished/lib/types/color";

export const isSameRgb = (a: RgbColor, b: RgbColor) => !(
  (a.red !== b.red) ||
  (a.green !== b.green) ||
  (a.blue !== b.blue)
)

export function colorInterpolate(a: RgbColor, b: RgbColor, p: number): RgbColor {
  const lerp = (v1: number, v2: number) => Math.round(v1 * (1 - p) + v2 * p);

  return {
    red: lerp(a.red, b.red),
    green: lerp(a.green, b.green),
    blue: lerp(a.blue, b.blue),
  }
}

export function createCssStrokeFx(size: number, color: string, options: { precision: number, unit: string }) {
  const { precision = 1, unit = 'px' } = options;
  const shadow = [];
  let from = -size;
  for (let i = from; i <= size; i += size * precision) {
    for (let j = from; j <= size; j += size * precision) {
      shadow.push(`${i}${unit} ${j}${unit} 0 ${color}`)
    }
  }

  return shadow.join(', ')
}

export const getNextDeck = (index: DeckIndex): DeckIndex => [1, 2, 0][index];
