import type { DeckIndex } from "@seamless-medley/medley";
import { chain, random } from "lodash";
import { adjustHue, hsl } from "polished";
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

export const randomColors = (n: number) => chain(n).times().map(i => adjustHue((i - (n/2)) * random(15, 20), hsl(random(360), random(0.5, 0.9, true), random(0.6, 0.8, true)))).value()

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

export const getNextDeck = (index: DeckIndex | undefined): DeckIndex | undefined => index !== undefined ? [1, 2, 0][index] : undefined;
