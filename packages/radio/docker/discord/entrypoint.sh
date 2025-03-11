#!/bin/sh

if [ "$UV_THREADPOOL_SIZE" -eq 4 ]; then
  # shellcheck disable=SC2155
  # shellcheck disable=SC2046
  export UV_THREADPOOL_SIZE=$(nproc)
fi

# Execute Tini with the provided arguments
exec /tini -- "$@"
