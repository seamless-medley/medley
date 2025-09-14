import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';
import { inc, parse, ReleaseType } from 'semver';
import { PackageJson } from 'type-fest';

const types = ['major', 'minor', 'patch'];

async function bump(type: ReleaseType = 'patch') {
  const packageFile = require.resolve('../package.json');
  const packageJSON = require(packageFile) as Required<PackageJson>;

  const uiPackageFile = require.resolve('../../ui/package.json');
  const uiPackageJSON = require(uiPackageFile) as Required<PackageJson>;

  const isPre = !types.includes(type);

  const version = isPre ? inc(packageJSON.version, 'prerelease', type)! : inc(packageJSON.version, type)!;
  const v = parse(version);

  await writeFile(
    './src/version.ts',
    [
      `export const version = ${JSON.stringify(v?.version, null, 2)};`
    ].join('\n') + '\n'
  );

  packageJSON.version = version;
  uiPackageJSON.version = version;

  await writeFile(packageFile, JSON.stringify(packageJSON, null, 2) + '\n');
  await writeFile(uiPackageFile, JSON.stringify(uiPackageJSON, null, 2) + '\n');
}

bump(argv[2] as any);
