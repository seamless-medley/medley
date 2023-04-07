FROM node:18.13.0

# install build dependencies
RUN apt update && apt install g++ make pkg-config libtag1-dev libsamplerate0-dev libfreetype6-dev libcurl4-openssl-dev libasound2-dev libx11-dev libxrandr-dev -y
RUN npm install -g pnpm

RUN mkdir /app /musics
COPY . ./app

WORKDIR /app
RUN git submodule update --init --force --recursive

RUN pnpm install

# cleanup unnecessary files/folders
RUN rm -rfv .git .github .dockerignore .editorconfig .gitignore
RUN rm -rfv /app/packages/radio/.env

WORKDIR /app/packages/radio

CMD pnpm run dev:bot
