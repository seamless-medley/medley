import worklet from "./worklets/karaoke-module.js?worker&url";

type ParamNames = 'mix' | 'bg';

export class KaraokeFx {
  #context: AudioContext;

  #input: AudioNode;
  #output: AudioNode;

  #splitter: ChannelSplitterNode;
  #monoAttenuator: GainNode;

  #lowpass: BiquadFilterNode;
  #highpass: BiquadFilterNode;

  #processor: AudioWorkletNode;

  #params: Map<string, AudioParam>;

  #bypassed?: boolean;

  constructor(context: AudioContext) {
    this.#context = context;

    this.#splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
    this.#monoAttenuator = new GainNode(context, { gain: 0.25, channelCount: 1 });

    this.#lowpass = new BiquadFilterNode(context, {
      type: 'lowpass',
      Q: 3.5,
      frequency: 125
    });

    this.#highpass = new BiquadFilterNode(context, {
      type: 'highpass',
      Q: 2.0,
      frequency: 7000
    });

    this.#processor = new AudioWorkletNode(context, 'medley-karaoke', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.#splitter.connect(this.#monoAttenuator, 0);
    this.#splitter.connect(this.#monoAttenuator, 1);
    this.#monoAttenuator.connect(this.#lowpass).connect(this.#highpass).connect(this.#processor, 0, 1);

    this.#params = (this.#processor.parameters as unknown as Map<string, AudioParam>);

    this.#input = new GainNode(context);
    this.#output = new GainNode(context);
    this.bypass = true;
  }

  set(name: ParamNames, value: number, duration?: number) {
    const param = this.#params.get(name);
    if (!param) {
      return;
    }

    if (!duration) {
      param.setValueAtTime(value, this.#context.currentTime + 0.01);
      return;
    }

    param.setTargetAtTime(value, this.#context.currentTime + duration, duration * 0.33);
  }

  #buildGraph() {
    this.#input.connect(this.#splitter);
    this.#input.connect(this.#processor, 0, 0).connect(this.#output);
  }

  get input() {
    return this.#input;
  }

  connect(out: AudioNode): this {
    this.#output.disconnect();
    this.#output.connect(out);
    return this;
  }

  set bypass(bypassing: boolean) {
    if (this.#bypassed === bypassing) {
      return;
    }

    this.#input.disconnect();
    this.#processor.disconnect();

    this.#bypassed = bypassing;

    if (!bypassing) {
      this.#buildGraph();
    } else {
      this.#input.connect(this.#output);
    }
  }

  get bypass() {
    return this.#bypassed ?? false;
  }

  static #prepared = false;

  static async prepare(context: AudioContext) {
    if (this.#prepared) {
      return;
    }

    try {
      await context.audioWorklet.addModule(worklet);
      this.#prepared = true;
    }
    catch (e) {
      console.error('Error loading medley-karaoke audio worklet', e);
    }
  }
}
