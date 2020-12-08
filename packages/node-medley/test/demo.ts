import { Medley, Queue } from '../src';

const q = new Queue();
let m = new Medley(q);

m.on('loaded', (deck) => {
  console.log('Loaded', deck);
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

m.play();