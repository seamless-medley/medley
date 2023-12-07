const tty = require('tty');

const { env = {} } = typeof process === "undefined" ? {} : process;

const isCompatibleTerminal = tty && tty.isatty && tty.isatty(1) && env.TERM;
const isCI = "CI" in env && ("GITHUB_ACTIONS" in env || "GITLAB_CI" in env || "CIRCLECI" in env);

const isColorSupported = isCompatibleTerminal || isCI;

/**
 *
 * @param {number} index
 * @param {string} s
 * @param {string} close
 * @param {string} replace
 * @param {string} head
 * @param {string} tail
 * @param {number} next
 * @returns {string}
 */
function replaceClose(
  index, s, close, replace,
  head = s.substring(0, index) + replace,
  tail = s.substring(index + close.length),
  next = tail.indexOf(close)
) {
  return head + (next < 0 ? tail : replaceClose(next, tail, close, replace))
}

/**
 *
 * @param {number} index
 * @param {*} s
 * @param {string} open
 * @param {string} close
 * @param {string} replace
 * @returns
 */
function clearBleed(index, s, open, close, replace) {
  return (index < 0)
    ? open + s + close
    : open + replaceClose(index, s, close, replace) + close
}

/**
 *
 * @param {string} open
 * @param {string} close
 * @param {string} replace
 * @param {number} at
 */
function filterEmpty(open, close, replace = open, at = open.length + 1) {
  /**
   * @param {string} s
   */
  return (s) =>
    s || !(s === "" || s === undefined)
      ? clearBleed(
          ("" + s).indexOf(close, at),
          s,
          open,
          close,
          replace
        )
      : ""
}

/**
 *
 * @param {*} open
 * @param {*} close
 * @param {string} [replace]
 */
function makeEscape(open, close, replace) {
  return filterEmpty(`\u001b[${open}m`, `\u001b[${close}m`, replace);
}

/**
 *
 * @param {number} color
 * @param {boolean} bg
 */
const makeCube = (color, bg = false) => {
  if (!isColorSupported) {
    /**
     * @param {*} s
     */
    return s => s;
  }

  const code = bg ? 48 : 38;
  return makeEscape(`${code};5;${color}`, code + 1)
}

const reset = makeEscape(0, 0);
const bold = makeEscape(1, 22, "\u001b[22m\u001b[1m");
const italic = makeEscape(3, 23);
const underline = makeEscape(4, 24);
const strikethrough = makeEscape(9, 29);

module.exports = {
  makeEscape,
  makeCube,
  reset,
  bold,
  italic,
  underline,
  strikethrough
}

