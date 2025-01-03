const tty = require('node:tty');

const isColorSupported = (() => {
  const isTTY = tty?.isatty(1);

  if (!isTTY) {
    return;
  }

  const { env = {} } = typeof process === "undefined" ? {} : process;

  if (env.TERM) {
    return true;
  }

  if (process.platform === 'win32') {
    return true;
  }

  const isCI = "CI" in env && ("GITHUB_ACTIONS" in env || "GITLAB_CI" in env || "CIRCLECI" in env);
  if (isCI) {
    return true;
  }

  if ('COLORTERM' in env) {
    return true;
  }
})() ?? false;

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



function createColor(useColors = isColorSupported) {
  /**
   *
   * @param {*} open
   * @param {*} close
   * @param {string} [replace]
   */
  function makeEscape(open, close, replace) {
    if (!useColors) {
      /**
       * @param {*} s
       */
      return s => s;
    }

    return filterEmpty(`\u001b[${open}m`, `\u001b[${close}m`, replace);
  }

  /**
   *
   * @param {number} color
   * @param {boolean} bg
   */
  const makeCube = (color, bg = false) => {
    if (!useColors) {
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

  return {
    makeCube,
    reset,
    bold,
    italic,
    underline,
    strikethrough
  }
}

module.exports = {
  isColorSupported,
  createColor
}

