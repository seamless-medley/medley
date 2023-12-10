FROM node:18.16.0

RUN apt update && apt install git g++ make pkg-config libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev -y
RUN npm install -g pnpm

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

WORKDIR /src

RUN pnpm install

WORKDIR /src/${PKG_MEDLEY}

RUN pnpm prebuild
