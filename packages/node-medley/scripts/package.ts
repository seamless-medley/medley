import { PackageJson } from 'type-fest';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
// TODO: Use fs-extra

async function transform() {
  const p = require('../package.json') as Required<PackageJson>;

  p.main = 'index.js';
  p.types = 'index.d.ts';

  p.scripts = {};

  delete p.gypfile;
  delete (p as any).devDependencies;

  await mkdirp('dist');

  return JSON.stringify(p, null, 2);
}

transform().then(s => fs.createWriteStream('dist/package.json').write(s));
