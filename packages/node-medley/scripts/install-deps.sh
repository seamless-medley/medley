#!/usr/bin/sh

TAGLIB_VERSION=2.0.2
LIBSAMPLERATE_VERSION=0.2.2

SUDO=sudo
if [ "$1" = "--no-sudo" ]; then
    SUDO=""
fi

wget https://github.com/taglib/taglib/archive/refs/tags/v${TAGLIB_VERSION}.tar.gz \
    -O taglib.tar.gz
tar xvf taglib.tar.gz
mv taglib-* taglib
cd taglib \
    && cmake \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_TESTING=0
        . \
    && make -j 2 \
    && ${SUDO} make install

# shellcheck disable=SC2181
if [ $? -ne 0 ]; then
    echo "Error compiling taglib"
    exit 1
fi

wget https://github.com/libsndfile/libsamplerate/releases/download/${LIBSAMPLERATE_VERSION}/libsamplerate-${LIBSAMPLERATE_VERSION}.tar.xz \
    -O libsamplerate.tar.gz
tar xvf libsamplerate.tar.gz
mv libsamplerate-* libsamplerate
cd libsamplerate \
    && cmake . \
    && make -j 2 \
    && ${SUDO} make install

# shellcheck disable=SC2181
if [ $? -ne 0 ]; then
    echo "Error compiling libsamplerate"
    exit 1
fi
