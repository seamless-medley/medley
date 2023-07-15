# TODO: Move this file into packages/radio
FROM node:18.16.0 as builder

ENV TZ="Asia/Bangkok"

# install build dependencies
RUN apt update && apt install git g++ make pkg-config libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev -y && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

RUN mkdir /app /musics /node_modules
COPY . ./app

WORKDIR /app

RUN pnpm config set -g virtual-store-dir "/node_modules"
RUN pnpm config list

RUN --mount=type=cache,target=/node_modules,id=node_modules pnpm install
RUN --mount=type=cache,target=/node_modules,id=node_modules pnpm combine-discord

WORKDIR /app/packages/radio/combine/discord
RUN npm install
# --omit=optional

# TODO: proper generate application banner version (git short commit)
RUN echo "---------------------------------------------------------" > version
RUN echo "APP version: $(git branch --show-current):$(git rev-parse HEAD | cut -c 1-8)" >> version
RUN echo "Build date: $(date)" >> version
RUN echo "---------------------------------------------------------" >> version
RUN echo "" >> version

FROM node:18.16.0-slim as application

ENV TZ="Asia/Bangkok"

RUN apt update && apt install tzdata libtag1v5 libsamplerate0 libasound2 libfreetype6 libcurl4 watchman -y && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/packages/radio/combine/discord /app
COPY --from=builder /app/packages/radio/config-docker.yml /app

WORKDIR /app

# TODO:
# - Remove this and use command for starting radio bot
# - proper get application version (git short commit)
CMD echo "$(cat /app/version)" && node radio/discord/bot_main.js config-docker.yml
