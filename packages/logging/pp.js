const { levels } = require('pino');
const { default: pp  } = require('pino-pretty');
const { createColors } = require('colorette');

const availableColors = createColors({ useColor: true });

const {
  reset,
  dim,
  bold,
  underline,
  white,
  red,
  yellow,
  green,
  blue,
  gray,
  cyan,
} = availableColors;

const {
  whiteBright,
  bgRedBright,
  redBright,
  yellowBright,
  greenBright,
  blueBright,
  cyanBright,
} = availableColors;

const {
  bgWhite,
  bgRed,
  bgYellow,
  bgGreen,
  bgBlue,
  bgCyan,
} = availableColors;

const levelColored = {
  60: bgRed,
  50: red,
  40: yellow,
  30: green,
  20: blue,
  10: gray,
}

/**
 *
 * @param {*} c
 * @returns {string}
 */
function formatLevel(c) {
  const l = c.toString();
  const lb = levels.labels[l] ?? l;
  return (levelColored[l] ?? white)(`${lb.toUpperCase().padStart(5)}`)
}

/**
 * @param {Record<string, unknown>} log
 */
function formatMessage(log) {
  const { $L, msg } = log;
  /** @type {import('.').LoggerMetadata} */
// @ts-ignore
  const m = $L;
  const { type, id } = m;

  let line = reset('[') + blue(type) + reset(']');

  if (id) {
    line += blue(underline(bold('[') + id + bold(']')));
  }

  return line + reset(` - ${msg}`);
}

/** @typedef {import('pino-pretty').PrettyOptions} PrettyOptions */

module.exports = () => {
  /** @type {PrettyOptions} */
  const options = {
    customPrettifiers: {
      level: formatLevel
    },
    messageFormat: formatMessage,
    ignore: '$L'
  }

  return pp(options);
}
