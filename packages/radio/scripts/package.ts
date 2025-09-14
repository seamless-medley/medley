import { join } from 'node:path';
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

async function packageApp() {
  const packagePath = './package';

  await emptyDir(packagePath);

  const copyTasks = [
    copy('../utils/dist', join(packagePath, 'utils'), { filter: src => !/package.json$/.test(src) }),
    copy('../ui/dist', join(packagePath, 'ui')),
    copy('build', join(packagePath, 'radio'))
  ]

  await Promise.all(copyTasks);

  const mainPackage = require('../package.json') as PackageJson;

  const depTransformMap = new Map<string, string | false>([
    ['@seamless-medley/utils', './utils'],
    ['@seamless-medley/remote', false]
  ]);

  const deps = chain({})
    .extend(
      ...[
        'utils'
      ].map(name => (require(`../../${name}/package.json`) as PackageJson).dependencies),
      mainPackage.dependencies
    )
    .transform((o, value, key) => {
      const newValue = depTransformMap.get(key);

      if (newValue !== false) {
        o[key] = newValue || value;
      }

      return o;
    }, {})
    .value();

  const result = chain(mainPackage)
    .pick('name', 'version', 'description', 'author', 'keyword', 'license')
    .extend({ main: 'radio/server/main.js' })
    .extend({ dependencies: deps })
    .value();

  result.version = await getVersionString(result.version!);

  await outputJson(join(packagePath, 'package.json'), result, { spaces: 2 });

  await outputJson(join(packagePath, 'build-info.json'), {
    buildDate: Date.now()
  }, { spaces: 2 });

  await outputFile(join(packagePath, 'README.md'), [
    '```sh',
    'npm i',
    '```'
  ].join('\n'));
}

packageApp();
