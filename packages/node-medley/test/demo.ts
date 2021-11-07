import fs from 'fs';
import { Medley, Queue } from '../';

const sampleRate = 44100;
const duration = 5.0;

const totalSamples = sampleRate * duration;
const sineWaveSample = (f: number, rate: number, phase: number) => Math.sin(2 * Math.PI * f * (phase % rate) / rate);

const q = new Queue();
let m = new Medley(q);

songs.sort(() => 0.5 - Math.random()).forEach(s => q.add(s));

// const nullDevice = m.getAvailableDevices().filter(d => d.type == 'Null')[0];
// m.setAudioDevice({ type: nullDevice.type, device: nullDevice.defaultDevice });

m.on('loaded', (deck) => {
  console.log('Loaded', deck, m.getMetadata(deck));
});

m.on('unloaded', (deck) => {
  console.log('Unloaded', deck);
});

m.on('started', (deck) => {
  console.log('Started', deck);
});

m.on('finished', (deck) => {
  console.log('Finished', deck);
});

const audioStream = m.requestAudioStream({
  format: 'Int16LE',
  sampleRate: 48000
});

console.log('audioStream', audioStream);

const out = fs.createWriteStream('test.audio');

audioStream.stream.pipe(out);

m.play();

console.log(m.getAvailableDevices());

// setInterval(() => console.log(m.level), 1000);