import { Medley, Queue } from '..';

function log(name: string, ...args: any[]) {
  console.log(`${new Date().toISOString()}> [${name}]:`, ...args)
}

function nodeLog(...args: any[]) {
  log('demo', ...args);
}

async function main() {
  const env = process.env;
  const isCI = "CI" in env && ("GITHUB_ACTIONS" in env || "GITLAB_CI" in env || "CIRCLECI" in env);

  nodeLog(Medley.getInfo());

  const queue = new Queue();
  const medley = new Medley(queue, { logging: true, skipDeviceScanning: isCI });

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

  medley.on('loaded', (deck, trackPlay) => {
    nodeLog('Loaded', deck, medley.getDeckMetadata(deck));
    nodeLog('Audio Properties', Medley.getAudioProperties(trackPlay.track.path));
  });

  medley.on('unloaded', (deck) => {
    nodeLog('Unloaded', deck);
  });

  medley.on('started', (deck) => {
    nodeLog('Started', deck);
  });

  medley.on('finished', (deck) => {
    nodeLog('Finished', deck);
  });

  medley.on('log', (level, name, s) => {
    log(name, s);
  })

  medley.play();

  const timeout = +process.argv.slice(2);
  if (timeout > 0) {
    setTimeout(() => {
      process.exit(0);
    }, timeout * 1000)
  }
}

main();
