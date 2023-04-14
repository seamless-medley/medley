import { PackageJson } from 'type-fest';
import mkdirp from 'mkdirp';
import fs from 'fs';

async function transform() {
  const p = require('../package.json') as Required<PackageJson>;

  p.main = 'index.js';
  p.types = 'index.d.ts';

  p.scripts = {
    install: 'node-gyp-build'
  }

  delete p.gypfile;
  delete (p as any).devDependencies;

  await mkdirp('dist');

  return JSON.stringify(p, null, 2);
}

transform().then(s => fs.createWriteStream('dist/package.json').write(s));
