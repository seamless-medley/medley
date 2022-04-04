import { Medley, Queue } from '..';

async function main() {
  const q = new Queue();
  let m = new Medley(q);

  let index = 0;

  const tracks = [
    __dirname + '/bensound-sexy.mp3',
    __dirname + '/bensound-clapandyell.mp3',
    __dirname + '/bensound-dance.mp3',
    __dirname + '/bensound-dubstep.mp3'
  ];

  m.on('enqueueNext', (done) => {
    const track = tracks[index];
    index = (index + 1) % tracks.length;
    q.add(track);

    done(true);
  });

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
}

main();
