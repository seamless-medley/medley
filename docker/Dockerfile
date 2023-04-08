FROM node:18.13.0 as builder

ENV TZ="Asia/Bangkok"

# install build dependencies
RUN apt update && apt install g++ make pkg-config libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev -y && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

RUN mkdir /app /musics
COPY . ./app

WORKDIR /app
RUN git submodule update --init --force --recursive

# TODO: Install without devDependencies
RUN pnpm install

# TODO: proper generate application banner version (git short commit)
RUN echo "---------------------------------------------------------" > version
RUN echo "APP version: $(git rev-parse HEAD | cut -c 1-8)" >> version
RUN echo "Build date: $(date)" >> version
RUN echo "---------------------------------------------------------" >> version
RUN echo "" >> version

# TODO: cleanup unneccesary node_modules (dev-dependencies)
# RUN wget https://gobinaries.com/tj/node-prune --output-document - | /bin/sh && node-prune

FROM node:18.13.0-slim as application

ENV TZ="Asia/Bangkok"

RUN apt update && apt install tzdata libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev -y && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app /app

WORKDIR /app
# cleanup unnecessary files/folders
RUN rm -rfv .git .github .dockerignore .editorconfig .gitignore
RUN rm -rfv /app/packages/radio/.env

RUN npm i pnpm -g

WORKDIR /app/packages/radio

# TODO: Remove this and use command for starting radio bot
CMD pnpm run dev:bot
