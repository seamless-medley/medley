import { join, sep } from 'node:path';
import { emptyDir, copy, outputJson, outputFile } from 'fs-extra';
import type { PackageJson } from 'type-fest';
import { chain } from 'lodash';
import simpleGit  from 'simple-git';

async function getVersionString(mainVersion: string) {
  const git = simpleGit();

  const branch = await git.revparse(['--abbrev-ref', 'HEAD']);

  if (branch === 'main') {
    return mainVersion;
  }

  const shortHash = await git.revparse(['--short', 'HEAD']);
  return `${branch}:${shortHash}`;
}

async function combine() {
  const combinePath = './combine/discord';

  await emptyDir(combinePath);

  const copyTasks = [
    copy('../utils/dist', join(combinePath, 'utils'), { filter: src => !/package.json$/.test(src) }),
    copy('dist', join(combinePath, 'radio'), {
      filter: (src) => {
        const [, group] = src.split(sep);

        if (/^(server|ui|socket|remotes|streaming|poc-)/.test(group)) {
          return false;
        }

        return true
      }
    })
  ]

  await Promise.all(copyTasks);

  const mainPackage = require('../package.json') as PackageJson;

  const deps = chain({})
    .extend(
      ...[
        'utils'
      ].map(name => (require(`../../${name}/package.json`) as PackageJson).dependencies),
      mainPackage.dependencies
    )
    .omitBy((_, name) => /^(socket\.io|react|express|@mantine|framer-motion|ffmpeg|reflect-metadata|notepack.io|opus-decoder|mediasoup|polished|@tanstack|@fontsource|@linaria|@tabler|@wyw|overlayscrollbars)/.test(name ?? ''))
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

  result.version = await getVersionString(result.version!);

  await outputJson(join(combinePath, 'package.json'), result, { spaces: 2 });

  await outputFile(join(combinePath, 'banner.txt'), [
    'Medley (Discord)',
    `Version: ${result.version}`,
    `Build date: ${Date()}`
  ].join('\n'));

  await outputFile(join(combinePath, 'README.md'), [
    '```sh',
    'npm i',
    '```'
  ].join('\n'));
}

combine();
