import { basename, join, sep } from 'path';
import { emptyDir, copy, outputJson, outputFile } from 'fs-extra';
import type { PackageJson } from 'type-fest';
import { chain } from 'lodash';


async function combine() {
  const combinePath = './combine/discord';

  await emptyDir(combinePath);

  const copyTasks = [
    copy('../utils/dist', join(combinePath, 'utils'), { filter: src => !/package.json$/.test(src) }),
    copy('../core/dist', join(combinePath, 'core'), { filter: src => !/package.json$/.test(src) }),
    copy('dist', join(combinePath, 'radio'), {
      filter: (src) => {
        const [, group] = src.split(sep);

        if (/^(server|ui|socket|streaming|poc-)/.test(group)) {
          return false;
        }

        if (/^fixtures.js/.test(basename(src))) {
          return false;
        }

        return true
      }
    })
  ]

  await Promise.all(copyTasks);

  const mainPackage = require('../package.json') as PackageJson;
  const { dependencies: coreDeps = {} } = (require('../../core/package.json') as PackageJson);
  const { dependencies: utilsDeps = {} } = require('../../utils') as PackageJson;

  const deps = chain({})
    .extend(utilsDeps, coreDeps, mainPackage.dependencies)
    .omitBy((_, name) => /^(@emotion|socket\.io|react|express|valtio|@mantine|framer-motion|ffmpeg|jotai|reflect-metadata|axios|notepack.io|opus-decoder)/.test(name ?? ''))
    .transform((o, value, key) => {
      if (key.startsWith('@seamless-medley/') && value?.startsWith('..')) {
        o[key] = value.substring(1);
      } else {
        o[key] = value;
      }

      return o;
    }, {})
    .value();

  const result = chain(mainPackage)
    .pick('name', 'version', 'description', 'author', 'keyword', 'license')
    .extend({ main: 'radio/discord/bot_main.js' })
    .extend({ dependencies: deps })
    .value();

  await outputJson(join(combinePath, 'package.json'), result, { spaces: 2 });

  await outputFile(join(combinePath, 'README.md'), [
    '```sh',
    'npm i --omit=optional',
    '```'
  ].join('\n'));
}

combine();
