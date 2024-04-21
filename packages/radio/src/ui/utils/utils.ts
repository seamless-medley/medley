import { RgbColor } from "polished/lib/types/color";

export function formatDuration(seconds: number, options?: { withMs?: boolean }) {
    const [mm, ss, ms] = [
        Math.trunc(seconds / 60),
        Math.trunc(seconds % 60),
        Math.trunc(seconds % 1 * 100)
    ].map(e => e.toString().padStart(2, '0'))

    return `${mm}:${ss}` + (options?.withMs ? `.${ms}` : '');
}

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
