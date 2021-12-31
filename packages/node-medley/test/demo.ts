import { Medley, Queue } from '..';

const q = new Queue();
let m = new Medley(q);

q.add(__dirname + '/bensound-sexy.mp3');
q.add(__dirname + '/bensound-clapandyell.mp3');
q.add(__dirname + '/bensound-dance.mp3');
q.add(__dirname + '/bensound-dubstep.mp3');

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

m.play();