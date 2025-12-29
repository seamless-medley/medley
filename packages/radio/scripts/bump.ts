import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';
import { inc, parse, ReleaseType } from 'semver';
import { PackageJson } from 'type-fest';
import simpleGit from 'simple-git';

const types = ['major', 'minor', 'patch'];

async function bump(type: ReleaseType = 'patch') {
  const git = simpleGit();

  // Check for staged changes
  const status = await git.status();
  if (status.staged.length > 0) {
    console.error('Error: You have staged changes. Please commit or unstage them before bumping the version.');
    console.error('Staged files:');
    status.staged.forEach(file => console.error(`  - ${file}`));
    process.exit(1);
  }

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

  // Create git tag
  const tagName = `radio@v${version}`;

  await git.add([
    'package.json',
    'src/version.ts',
    '../ui/package.json'
  ]);

  console.log(`Version bumped to ${version}`);
  console.log(`Git tag: ${tagName}`);
}

bump(argv[2] as any);
