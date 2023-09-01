const { stubFalse, noop } = require('lodash');
const workerpool = require('workerpool');
const fg = require('fast-glob');
const normalizePath = require('normalize-path');

/**
 * @async
 * @param {string} dir
 * @returns {Promise<false | string[]>}
 */
function scanDir(dir) {
  return fg(
    `${normalizePath(dir)}/**/*`,
    {
      absolute: true,
      onlyFiles: true,
      braceExpansion: true,
      suppressErrors: true,
    }
  )
  .catch(stubFalse);
}

workerpool.worker({
  scanDir
});

process.on('uncaughtException', noop);
process.on('unhandledRejection', noop);
