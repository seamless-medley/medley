import { Queue, Medley } from '../';

const q = new Queue();
let m = new Medley(q);

songs.sort(() => 0.5 - Math.random()).forEach(s => q.add(s));
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
  format: 'Int16LE'
});

console.log('audioStream', audioStream);

const out = fs.createWriteStream('test.audio');

audioStream.stream.pipe(out);

m.play();

// setInterval(() => console.log(m.level), 1000);