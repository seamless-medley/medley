import { Medley, Queue } from '..';
import { extname } from 'node:path';
import test, { ExecutionContext } from 'ava';

test.serial('Native module loading', t => {
  const info = Medley.getInfo();
  t.truthy(info);
  t.is(info.versionString, require('../package.json').version);
});

const tracks = ['mp3', 'opus', 'flac', 'ogg', 'wav', 'aiff'].map(ext => `${__dirname}/bensound-dance.${ext}`);

const middlec = [
  { ext: 'mp3', sampleRate: 44100 },
  { ext: 'opus', sampleRate: 48000 },
  { ext: 'flac', sampleRate: 44100 },
  { ext: 'ogg', sampleRate: 44100 },
  { ext: 'wav', sampleRate: 44100 },
  { ext: 'aiff', sampleRate: 44100 }
]

for (const track of tracks) {
  test.serial(`${extname(track).toUpperCase().substring(1)} Track loading`, t => {
    t.true(Medley.isTrackLoadable(track));
  });
}

test.serial('Exotic MP3 tracks loading', async t => {
  const testTracks: [string, boolean][] = [
    ['invalid-frames1.mp3', true],
    ['invalid-frames2.mp3', true],
    ['invalid-frames3.mp3', true],
    ['rare_frames.mp3', true],
    ['garbage.mp3', true],
    ['excessive_alloc.mp3', false]
   ];

   for (const [track, result] of testTracks) {
    t.is(Medley.isTrackLoadable(__dirname + '/' + track), result, track);
  }
});


const testAudioProperties = (ext: string, sampleRate: number) => (t: ExecutionContext) => {
  const props = Medley.getAudioProperties(`${__dirname}/middlec.${ext}`);

  t.assert(typeof props === 'object', 'Medley.getAudioProperties must return an object');
  t.is(props.channels, 2);
  t.is(props.sampleRate, sampleRate);
  t.assert(typeof props.bitrate === 'number' || typeof props.bitrate === 'undefined', 'bitrate must be a number or undefined');
  t.is(Math.round(props.duration ?? 0), 5);
}

const testCoverAndLyrics = (ext: string) => (t: ExecutionContext) => {
  const result = Medley.getCoverAndLyrics(`${__dirname}/middlec.${ext}`);

  t.assert(typeof result === 'object', 'Medley.getCoverAndLyrics must return an object');
  t.is(result.coverMimeType, 'image/jpeg');
  t.true(Buffer.isBuffer(result.cover));
  t.is(result.cover.byteLength, 4856);
  t.is(result.lyrics, 'middle c');
}

for (const { ext, sampleRate } of middlec) {
  test.serial(`Audio Properties: middlec.${ext}`, testAudioProperties(ext, sampleRate));
}

for (const { ext } of middlec) {
  test.serial(`Reading Cover and Lyrics: middlec.${ext}`, testCoverAndLyrics(ext));
}

test('Null Audio Device playback', t => {
  const queue = new Queue();
  const medley = new Medley(queue, { skipDeviceScanning: true });

  t.is(medley.constructor, Medley, `${Medley.name} instance expected`);

  t.true(
    medley.setAudioDevice({ type: 'Null', device: 'Null Device' }),
    'Null audio device'
  );

  queue.add(tracks[0]);
  t.true(medley.play());

  const sampleRate = 48_000;
  const playDuration = 2;

  t.timeout(1000 * (playDuration + 5));

  return new Promise(async (resolve) => {
    let started = false;
    let count = 0;

    const { stream, id } = await medley.requestAudioStream({ format: 'Int16LE', sampleRate });
    stream.on('data', (data: Buffer) => {
      if (started || data.some(v => v !== 0)) {
        started = true;
        count += data.length / 2 / 2;

        if (count >= sampleRate * playDuration) {
          medley.deleteAudioStream(id);
          resolve();
        }
      }
    });
  });
})

