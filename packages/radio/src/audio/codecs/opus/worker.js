// @ts-check
const { workerData, parentPort, MessagePort } = require('node:worker_threads');
const { OpusEncoder } = require('@discordjs/opus');

/** @type {Uint8Array[]} */
const pcmBuffers = workerData.pcmBuffers;

/** @type {Uint8Array[]} */
const opusBuffers = workerData.opusBuffers;

const encoder = new OpusEncoder(48000, 2);

/**
 *
 * @param {number} bufferSize
 * @param {number} slot
 * @param {MessagePort} port
 */
function encode(bufferSize, slot, port) {
  let opus;
  try {
    const buffer = Buffer.from(pcmBuffers[slot].slice(0, bufferSize));
    opus = encoder.encode(buffer);
    opusBuffers[slot].set(opus);
    port.postMessage(opus.length);
  }
  catch (e) {
    // @ts-ignore
    console.log('ERR', e.message, opus.length)
  }
}

parentPort?.on('message', (e) => {
   /** @type {string} */
  const fn = e.fn;

  switch (fn) {
    case 'encode':
      encode(e.bufferSize, e.slot, e.port);
      break;

    case 'bitrate':
      console.log('SETTING BITRATE', e.bitrate);
      encoder.setBitrate(e.bitrate);
      break;

    case 'ctl':
      console.log('CTL', e.c, e.value);
      encoder.applyEncoderCTL(e.c, e.value);
      break;
  }
});

process.on('uncaughtException', (e) => {
  console.log('WORKER EX', e);
})

process.on('unhandledRejection', (e) => {
  console.log('WORKER REJECT', e);
})
