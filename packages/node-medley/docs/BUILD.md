# How to build node-medley

## GitHub Actions
Usually, the native modules for all supported platforms are built using GitHub Actions [Workflow](../../.github/workflows/node-medley.yml)

## Version bumping
```sh
pnpm bump-version [major|minor|patch|<pre-release string>]
```

Be sure to bump the version before building since the version number will be compiled and embedded into the binary itself.

## Build manually

### Build for the host platform
Run the following command on each platform:
```sh
pnpm prebuild
```

### Build for Linux using [Docker](./docker/Dockerfile)

```sh
pnpm prebuild:linux
```

This will build the module using Docker on any platform.

The resulting binary will then be copied from the container into the `prebuilds` folder.


