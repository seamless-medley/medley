const { levels } = require('pino')
const { default: pp } = require('pino-pretty');
const { createColor, isColorSupported } = require('./color');

/**
 *
 * @param {string} s
 * @returns {number}
 */
function hashString(s) {
  let hash = 0;

  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }

  return hash;
}

const pad = (val, len = 2) => String(val).padStart(len, '0');

/**
 *
 * @param {import('.').PrettyTransportData} options
 * @returns
 */
module.exports = (options) => {
  const { configs } = options;
  const useColors = configs?.includes('use-colors') || isColorSupported;
  const noDate = Boolean(configs?.includes('hide-date'));

  const { makeCube, reset } = createColor(useColors);

  const white = makeCube(254);
  const lemonBg = makeCube(190, true);
  const dark = makeCube(234)

  const levelColored = {
    60: makeCube(160, true),
    50: makeCube(160),
    40: makeCube(227),
    30: makeCube(77),
    20: makeCube(33),
    10: (s) => lemonBg(dark(s))
  }

  const tagColors = [
    88,  124, 160,
    20,  56,  92,  128,
    21,  57,  93,  129,
    23,  95,  131, 167,
    24,  60,  96,  132,
    25,  61,  97,  133,
    26,  62,  98,  134,
    28,  64,  100, 136, 172,
    29,  65,  173, 209,
    30,  174, 210,
    31,  139, 175,
    34,  70,  106, 142, 178, 214,
    35,  71,  107, 143, 179, 215,
    36,  72,  108, 180, 216,
    37,  73,  181, 217
  ].map(c => makeCube(c));

  const typeColorsMap = new Map();

  /**
   *
   * @param {string} type
   * @returns {(s: string) => string}
   */
  function getTypeColor(type) {
    let color = typeColorsMap.get(type);
    if (color === undefined) {
      const hash = hashString(type.toString());

      color = tagColors[Math.abs(hash) % tagColors.length];
      typeColorsMap.set(type, color);
    }

    return color;
  }

  const tagColorsMap = new Map();

  /**
   *
   * @param {string} type
   * @param {string} id
   * @returns {(s: string) => string}
   */
  function getTagColor(type, id) {
    let colorMap = tagColorsMap.get(type);

    if (!tagColorsMap.has(type)) {
      colorMap = new Map();
      tagColorsMap.set(type, colorMap);
    }

    let color = colorMap.get(id);
    if (color === undefined) {
      const hash = hashString(id.toString());

      color = tagColors[Math.abs(hash) % tagColors.length];
      colorMap.set(id, color);
    }

    return color;
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

  const dimmedSep = makeCube(239);
  const msgColor = makeCube(249);
  const tagSep = dimmedSep('-');
  const dateMarker = makeCube(91)('>');
  const nsColor = makeCube(202);

  function formatNamespace(ns) {
    return nsColor(ns);
  }

  /**
   * @param {Record<string, unknown>} log
   */
  function formatMessage(log) {
    /**
     * @type {import('.').LoggerMetadata}
     * @ts-ignore */
    const m = log.$L;
    /**
     * @type {string}
     * @ts-ignore */
    const msg = log.msg;
    const { type, id } = m;

    let line = '';
    {
      const c = getTypeColor(type);
      line = reset('[') + c(type) + reset(']');
    }

    if (id) {
      const c = getTagColor(type, id);
      line += tagSep + c(`[${id}]`);
    }

    return line + reset(` ${dimmedSep('-')} ${msgColor(msg)}`);
  }

  /**
   * @param {*} t
   * @returns {string}
   */
  function formatTime(t) {
    const date = new Date(t);
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const HH = pad(date.getHours());
    const MM = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const L = pad(Math.floor(date.getMilliseconds() / 10));
    return dimmedSep(`${yyyy}-${mm}-${dd} ${HH}:${MM}:${ss}.${L}${dateMarker}`);
  }

  /** @type {import('pino-pretty').PrettyOptions} */
  const ppOptions = {
    translateTime: false,
    ignore: '$L',

    customPrettifiers: {
      time: !noDate ? formatTime : () => '',
      level: formatLevel,
      name: formatNamespace
    },
    messageFormat: formatMessage
  }

  return pp(ppOptions);
}
