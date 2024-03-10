import { dirname, join, resolve } from 'node:path';
import rebuild from '@electron/rebuild';
import { readdir, cp } from 'node:fs/promises';
import { rimraf } from 'rimraf';

const moduleDir = (name: string) => dirname(require.resolve(name));

const { version: electronVersion } = require(join(moduleDir('electron'), 'package.json'));
const buildPath = resolve(__dirname, '../');

async function run() {
  await rebuild({
    force: process.argv[2] === 'force',
    buildPath,
    onlyModules: ['opus'],
    electronVersion
  });

  const electronMajorVersion = electronVersion.split('.', 1)[0];

  const prebuildDir = resolve(moduleDir('@discordjs/opus'), '../prebuild');

  const dirs = await readdir(prebuildDir, { withFileTypes: true })
  const electronPrebuilds = dirs.filter(d => {
    if (!d.isDirectory()) {
      return false;
    }

    if (!d.name.startsWith(`electron-v${electronMajorVersion}`)) {
      return false;
    }

    return /(napi_build_version|libc_version)/.test(d.name);
  });

  for (const d of electronPrebuilds) {
    const oldName = join(prebuildDir, d.name);
    const newName = oldName
      .replace('{napi_build_version}', '3')
      .replace('{libc_version}', 'unknown')

    await rimraf(newName);
    await cp(oldName, newName, { recursive: true });
  }
}

run();
