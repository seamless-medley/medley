FROM node:18.16.0 as builder

RUN corepack enable

# install build dependencies
RUN apt update \
    && apt install \
        git \
        g++ \
        make \
        pkg-config \
        python3-pip \
        -y \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /app /build /musics /node_modules
COPY . ./build

WORKDIR /build
RUN pnpm install --ignore-scripts
RUN pnpm combine-discord

RUN cp -R /build/packages/radio/combine/discord/* /app

WORKDIR /app
RUN pnpm install

# TODO: proper generate application banner version (git short commit)
RUN echo "---------------------------------------------------------" > version
RUN echo "APP version: $(git branch --show-current):$(git rev-parse HEAD | cut -c 1-8)" >> version
RUN echo "Build date: $(date)" >> version
RUN echo "---------------------------------------------------------" >> version
RUN echo "" >> version

# ----------------------------------------------------------------------------------------------------
FROM node:18.16.0-slim as application

RUN apt update \
    && apt install \
        tzdata \
        libasound2 \
        libfreetype6 \
        watchman \
        -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app
# TODO: Remove this
COPY --from=builder /build/packages/radio/config-docker.yml /app

RUN mkdir -p /data/musics /data/drops

WORKDIR /app

# TODO:
# - Remove this and use command for starting radio bot
# - proper get application version (git short commit)

# TODO: The config file is meant to be mounted
CMD echo "$(cat /app/version)" && node radio/discord/bot_main.js config-docker.yml
