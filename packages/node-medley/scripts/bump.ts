import { writeFile } from 'fs/promises';
import { argv } from 'process';
import { inc, parse, ReleaseType } from 'semver';
import { PackageJson } from 'type-fest';

async function bump(type: ReleaseType = 'patch') {
  const path = require.resolve('../package.json');
  const p = require(path) as Required<PackageJson>;
  p.version = inc(p.version, type)!;

  const v = parse(p.version);

  if (v) {
    await writeFile('./src/version.h', ['major', 'minor', 'patch']
      .map(t => `#define MEDLEY_VERSION_${t.toUpperCase()} ${v[t]}`)
      .join('\n') + '\n')
  }

  await writeFile(path, JSON.stringify(p, null, 2) + '\n');
}

bump(argv[2] as any);
