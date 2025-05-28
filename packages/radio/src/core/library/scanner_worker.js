const { stubFalse, noop } = require('lodash');
const workerpool = require('workerpool');
const fg = require('fast-glob');
const normalizePath = require('normalize-path');
const { access } = require('node:fs/promises');
const { createLogger } = require('../../logging');

const logger = createLogger({ name: 'scanner' });

/**
 * @async
 * @param {string} dir
 * @returns {Promise<false | string[]>}
 */
async function scanDir(dir) {
  logger.debug(`scanDir: ${dir}`);
  const result = await fg(
    `${normalizePath(dir)}/**/*`,
    {
      absolute: true,
      onlyFiles: true,
      braceExpansion: true,
      suppressErrors: true,
    }
  )
  .catch(stubFalse);

  logger.debug(`scanDir: ${dir} done: ${result.length} entries`);

  return result;
}

/**
 *
 * @async
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
  return access(path).then(() => true).catch(() => false)
}

workerpool.worker({
  scanDir,
  fileExists
});

process.on('uncaughtException', noop);
process.on('unhandledRejection', noop);
