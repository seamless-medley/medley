import { Medley, Queue } from '..';
import test from 'ava';

test('Native module loading', t => {
  const info = Medley.getInfo();
  t.truthy(info);
  t.is(info.versionString, require('../package.json').version);
});

const track = __dirname + '/bensound-dance.mp3';

test('Track loading', t => {
  t.true(Medley.isTrackLoadable(track));
});

test('Null Audio Device playback', t => {
  const queue = new Queue();
  const medley = new Medley(queue);

  t.is(medley.constructor, Medley, `${Medley.name} instance expected`);

  t.true(
    medley.setAudioDevice({ type: 'Null', device: 'Null Device' }),
    'Null audio device'
  );

  queue.add(track);

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

