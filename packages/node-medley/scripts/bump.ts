import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';
import { inc, parse, ReleaseType } from 'semver';
import { PackageJson } from 'type-fest';

const types = ['major', 'minor', 'patch'];

async function bump(type: ReleaseType = 'patch') {
  const path = require.resolve('../package.json');
  const p = require(path) as Required<PackageJson>;

  const isPre = !types.includes(type);

  p.version = isPre ? inc(p.version, 'prerelease', type)! : inc(p.version, type)!;

  const v = parse(p.version);

  if (v) {
    const lines = types.map(t => `#define MEDLEY_VERSION_${t.toUpperCase()} ${v[t]}`);

    if (isPre) {
      lines.push(`#define MEDLEY_VERSION_PRE_RELEASE "${v.prerelease.join('.')}"`);
    }

    await writeFile(
      './src/version.h',
      lines.join('\n') + '\n'
    );
  }

  await writeFile(path, JSON.stringify(p, null, 2) + '\n');
}

bump(argv[2] as any);
