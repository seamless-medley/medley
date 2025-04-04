import { RgbColor } from "polished/lib/types/color";

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
