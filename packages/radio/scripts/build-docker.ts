import { execSync } from 'node:child_process';
import { PackageJson } from 'type-fest';

async function dockerBuild() {
  const packageJSON = require('../package.json') as Required<PackageJson>;
  const version = packageJSON.version;

  const tags = [
    `-t medley:${version}`,
    `-t medley:latest`
  ].join(' ');

  const cmd = `docker build --progress=plain -f ./docker/Dockerfile ${tags} ../..`;

  execSync(cmd, {
    stdio: 'inherit',
    cwd: __dirname + '/..'
  });
}

dockerBuild();
