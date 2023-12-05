const { pino } = require('pino');

/** @typedef {import('pino').pino} pino */

function createPrettyPrint() {
  return pino.transport({ target: './pp' });
}

function createStream() {
  const streams = [
    !process.env.DEBUG
      ? pino.destination()
      : createPrettyPrint()
  ];

  return (streams.length > 1) ? pino.multistream(streams) : streams[0];
}

const root = pino({
  base: undefined,
  level: process.env.DEBUG ? 'debug' : 'info',
}, createStream());

/**
 *
 * @param {import('.').LoggerOptions} options
 */
function createLogger(options) {
  return root.child({ '$L': {
    type: options.name,
    id: options.id
  }});
}

module.exports = {
  createLogger
}
