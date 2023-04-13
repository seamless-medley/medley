# TODO: Move this file into packages/radio
FROM node:18.13.0 as builder

ENV TZ="Asia/Bangkok"

# install build dependencies
RUN apt update && apt install git g++ make pkg-config libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev -y && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

RUN mkdir /app /musics /node_modules
COPY . ./app

WORKDIR /app
RUN git submodule update --init --force --recursive

RUN pnpm config set -g virtual-store-dir "/node_modules"
# RUN pnpm config set -g hoist false
RUN pnpm config list
# TODO: Install without devDependencies
RUN --mount=type=cache,target=/cache,id=cache mkdir -p /cache/build && cp -r /cache/build /app/packages/node-medley/build
RUN --mount=type=cache,target=/node_modules,id=node_modules pnpm install

# store build cache
RUN --mount=type=cache,target=/cache,id=cache cp -r /app/packages/node-medley/build /cache

# TODO: proper generate application banner version (git short commit)
RUN echo "---------------------------------------------------------" > version
RUN echo "APP version: $(git branch --show-current):$(git rev-parse HEAD | cut -c 1-8)" >> version
RUN echo "Build date: $(date)" >> version
RUN echo "---------------------------------------------------------" >> version
RUN echo "" >> version

# TODO: cleanup unneccesary node_modules (dev-dependencies)
# RUN wget https://gobinaries.com/tj/node-prune --output-document - | /bin/sh && node-prune

FROM node:18.13.0-slim as application

ENV TZ="Asia/Bangkok"

RUN apt update && apt install tzdata libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev watchman -y && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /cache
COPY --from=builder /node_modules /node_modules
COPY --from=builder /app /app

WORKDIR /app
# cleanup unnecessary files/folders
RUN rm -rf .git .github .dockerignore .editorconfig .gitignore
RUN rm -rf /app/packages/radio/.env

RUN npm i pnpm -g
RUN pnpm config set -g virtual-store-dir "/node_modules"
# RUN pnpm config set -g hoist false
RUN --mount=type=cache,target=/cache,id=node_modules cp -rv /cache/* /node_modules

WORKDIR /app/packages/radio

# TODO:
# - Remove this and use command for starting radio bot
# - proper get application version (git short commit)
CMD echo "$(cat /app/version)" && pnpm run dev:bot config-docker.yml
