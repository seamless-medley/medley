import { PackageJson } from 'type-fest';
import { emptyDir, copy, outputJson, existsSync, exists } from 'fs-extra';
import { stubFalse } from 'lodash';

async function main() {
  if (!existsSync('out')) {
    console.error('Invoke `pnpm run build` first');
    return;
  };

  const prebuildStatus = await Promise.all(
    ['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']
      .map(async p => [p, await exists(`prebuilds/${p}`).catch(stubFalse)] as [string, boolean])
  );

  const missingPrebuilds = prebuildStatus
    .filter(([name, found]) => !found)
    .map(([name]) => name);

  if (missingPrebuilds.length) {
    console.error('Missing prebuilds:', missingPrebuilds);
    return;
  }

  await emptyDir('dist');

  const copyTasks = [
    copy('out', 'dist/'),
    copy('src/index.d.ts', 'dist/index.d.ts'),
    copy('prebuilds', 'dist/prebuilds'),
    copy('README.md', 'dist/README.md')
  ];

  await Promise.all(copyTasks);

  const p = require('../package.json') as Required<PackageJson>;

  p.main = 'index.js';
  p.types = 'index.d.ts';

  p.scripts = {};

  delete p.gypfile;
  delete (p as any).devDependencies;

  await outputJson('dist/package.json', p, { spaces: 2 });
}

main();
