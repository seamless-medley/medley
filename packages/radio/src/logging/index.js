const { pino } = require('pino');

/** @typedef {import('pino').pino} pino */

function createPrettyPrint() {
  const configs = (process.env.LOG_PRETTY ?? '').split(',');
  return pino.transport({ target: './pp', options: { configs } });
}

function createStream(usePretty) {
  const streams = [
    !!(process.env.LOG_PRETTY || process.env.DEBUG)
      ? createPrettyPrint()
      : pino.destination()
  ];

  return (streams.length > 1) ? pino.multistream(streams) : streams[0];
}

const root = pino({
  base: undefined,
  level: process.env.DEBUG ? 'trace' : 'info',
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
