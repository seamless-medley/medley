import { PackageJson } from 'type-fest';
import { mapValues, omit } from 'lodash';
import mkdirp from 'mkdirp';
import fs from 'fs';

async function transform() {
  const p = require('../package.json') as Required<PackageJson>;

  p.main = p.main.replace(/src\/(.*).ts$/, '$1.js');
  p.dependencies = mapValues(p.dependencies, v => v?.replace(/workspace:../, '..'));

  await mkdirp('dist');

  return JSON.stringify(omit(p, 'scripts', 'devDependencies'), null, 2);
}

transform().then(s => fs.createWriteStream('dist/package.json').write(s));
