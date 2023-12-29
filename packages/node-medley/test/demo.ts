import { Medley, Queue } from '..';

async function main() {
  console.log(Medley.getInfo());

  const queue = new Queue();
  const medley = new Medley(queue, { logging: true });

  const r = await medley.requestAudioStream();

  r.stream.on('data', (pcmData) => {
    //
  });

  let index = 0;

  const tracks = [
    __dirname + '/bensound-sexy.mp3',
    __dirname + '/bensound-clapandyell.mp3',
    __dirname + '/bensound-dance.mp3',
    __dirname + '/bensound-dubstep.mp3'
  ];

  medley.on('enqueueNext', (done) => {
    const track = tracks[index];
    index = (index + 1) % tracks.length;
    queue.add(track);

    done(true);
  });

  medley.on('loaded', (deck) => {
    console.log('Loaded', deck, medley.getDeckMetadata(deck));
  });

  medley.on('unloaded', (deck) => {
    console.log('Unloaded', deck);
  });

  medley.on('started', (deck) => {
    console.log('Started', deck);
  });

  medley.on('finished', (deck) => {
    console.log('Finished', deck);
  });

  medley.on('log', (level, name, string) => {
    console.log(`[${name}]: ${string}`)
  })

  medley.play();
}

main();
