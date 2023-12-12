# How to build node-medley

## Github Actions
Usually, the native module for all supported platforms are built using Github Actions [Workflow](../../.github/workflows/node-medley.yml)

## Version bumping
```sh
pnpm bump-version [major|minor|patch|<pre-release string>]
```

Be sure to bump the version before building since the version number would be compiled and embeded into the binary itself.

## Build & Pack manually

### Build for the host platform
Issue the following command on each platform:
```sh
pnpm prebuild
```

### Build for Linux using [Docker](./builder/linux/Dockerfile)

```sh
pnpm prebuild:linux
```

This will build the module using Docker on any platforms.

The result binary will then be copied from container into the `prebuilds` folder.


