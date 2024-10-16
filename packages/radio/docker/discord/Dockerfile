FROM node:18.20.4 as builder

RUN corepack enable && corepack prepare pnpm@9.12.1

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

# ----------------------------------------------------------------------------------------------------
FROM node:18.20.4-slim as application

ARG ARCH=amd64

RUN apt update \
    && apt install \
        tzdata \
        libasound2 \
        libfreetype6 \
        -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

RUN mkdir -p /data/musics /data/drops

# Add Tini
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-${ARCH} /tini
RUN chmod +x /tini
ENTRYPOINT ["/tini", "--"]

WORKDIR /app

# The config file is meant to be mounted as volume from docker-compose.yml
# and must be named `config.yml` (absolute path: /app/config.yml)
CMD ["node", ".", "config.yml"]
