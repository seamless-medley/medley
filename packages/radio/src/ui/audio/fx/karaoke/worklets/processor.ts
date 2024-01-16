export class MedleyKaraoke extends AudioWorkletProcessor {
  process([source, bg]: Float32Array[][], [output]: Float32Array[][], parameters: Record<string, Float32Array>) {
    if (source.length < 2) {
      if (source.length > 0) {
        output.forEach(channel => channel.set(source[0]))
      }
      return true;
    }

    const mixParam = parameters.mix!;
    const bgParam = parameters.bg!;

    const [in_left, in_right] = source;
    const [out_left, out_right] = output;
    const [bg_mono] = bg;

    const samples = out_left.length;

    for (let i = 0; i < samples; i++) {
      const l = in_left[i];
      const r = in_right[i];

      const mix = mixParam.length > 1 ? mixParam[i] : mixParam[0];
      const bgLevel = bgParam.length > 1 ? bgParam[i] : bgParam[0];

      const bg = bg_mono[i] * 1.25 * bgLevel;
      const bgMix = bg * mix;

      out_left[i] = l - (r * mix) + bgMix;
      out_right[i] = r - (l * mix) + bgMix;
    }

    return true;
  }

  static get parameterDescriptors() {
    return [
      { name: 'mix', minValue: 0, maxValue: 1, defaultValue: 0.8 },
      { name: 'bg', minValue: 0, maxValue: 1, defaultValue: 0.65 }
    ];
  }
}
