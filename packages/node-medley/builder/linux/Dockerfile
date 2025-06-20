# This is for building linux native module using docker
# Usage: pnpm prebuild:linux[-arm64]

FROM node:20.18.0

RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@10.7.0

RUN apt -y update \
    && apt -y install \
        g++ \
        make \
        cmake \
        pkg-config \
        libasound2-dev \
        libfreetype-dev \
        libutfcpp-dev \
        libopus-dev \
        libopusfile-dev

ENV PKG_JUCE=packages/juce
ENV PKG_MINIMP3=packages/minimp3
ENV PKG_ENGINE=packages/engine
ENV PKG_MEDLEY=packages/node-medley

RUN mkdir -p /src /src/${PKG_JUCE} /src/${PKG_MINIMP3} /src/${PKG_ENGINE} /src/${PKG_MEDLEY}
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
RUN pnpm test

