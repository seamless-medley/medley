import mkdirp from 'mkdirp';
import fs from 'fs';

async function transform() {
  const p = require('../package.json');

  p.main = 'index.js';
  p.types = 'index.d.ts';

  p.scripts = {
    install: p.scripts.install
  }

  delete p.gypfile;
  delete p.devDependencies;

  await mkdirp('dist');

  return JSON.stringify(p, null, 2);
}

transform().then(s => fs.createWriteStream('dist/package.json').write(s));