# This is for bulding linux native module using docker
# Usage: pnpm prebuild:docker

FROM node:18.16.0

RUN corepack enable

RUN apt -y update \
    && apt -y install \
        g++ \
        make \
        cmake \
        pkg-config \
        libasound2-dev

ENV PKG_JUCE=packages/juce
ENV PKG_MINIMP3=packages/minimp3
ENV PKG_ENGINE=packages/engine
ENV PKG_MEDLEY=packages/node-medley

RUN mkdir -p /src /src${PKG_JUCE} /src/${PKG_MINIMP3} /src/${PKG_ENGINE} /src/${PKG_MEDLEY}
COPY ./package.json /src
COPY ./pnpm-workspace.yaml /src
COPY ./${PKG_JUCE} /src/${PKG_JUCE}
COPY ./${PKG_MINIMP3} /src/${PKG_MINIMP3}
COPY ./${PKG_ENGINE} /src/${PKG_ENGINE}
COPY ./${PKG_MEDLEY} /src/${PKG_MEDLEY}

RUN mkdir /build-deps
WORKDIR /build-deps
RUN sh /src/${PKG_MEDLEY}/scripts/install-deps.sh --no-sudo

WORKDIR /src

RUN pnpm install

WORKDIR /src/${PKG_MEDLEY}

RUN pnpm prebuild
