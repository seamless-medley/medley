export function interpolate(sourceValue: number, sourceRange: [min: number, max: number], targetRange: [min: number, max: number]) {
  const [sourceMin, sourceMax] = sourceRange;
  const [targetMin, targetMax] = targetRange;

  const sourceLength = (sourceMax - sourceMin);
  const targetLength = (targetMax - targetMin);
  const progress = (sourceValue - sourceMin);

  return targetMin + (targetLength * progress / sourceLength);
}
