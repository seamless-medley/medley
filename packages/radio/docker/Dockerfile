FROM node:20.19.5-bookworm AS builder

RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@10.26.1

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
RUN pnpm package

RUN cp -R /build/packages/radio/package/* /app

WORKDIR /app
RUN pnpm install

# ----------------------------------------------------------------------------------------------------
FROM node:20.19.5-bookworm-slim AS application

ARG ARCH=amd64

RUN apt update \
    && apt install \
        tzdata \
        libasound2 \
        libfreetype6 \
        libopus0 \
        libopusfile0 \
        -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

RUN mkdir -p /data/musics /data/drops

ENV UV_THREADPOOL_SIZE=4
ENV MEDLEY_IN_DOCKER=1

COPY packages/radio/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh


# Add Tini
ENV TINI_VERSION=v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-${ARCH} /tini
RUN chmod +x /tini

ENTRYPOINT ["/entrypoint.sh"]
WORKDIR /app

# The config file is meant to be mounted as volume from docker-compose.yml
# and must be named `config.yml` (absolute path: /app/config.yml)
CMD ["node", ".", "config.yml"]
