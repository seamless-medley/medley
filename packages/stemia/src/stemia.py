#!/usr/bin/env python3

import asyncio
import logging
import os

import websockets
from rich.logging import RichHandler

import core

logging.basicConfig(level=logging.INFO, handlers=[RichHandler(rich_tracebacks=True, show_path=False)])
log = logging.getLogger("stemia")
async def main():
    host = os.environ.get("STEMIA_HOST", "0.0.0.0")
    port = int(os.environ.get("STEMIA_PORT", "3002"))

    server = core.StemServer()

    asyncio.create_task(core.stem_worker(server))
    asyncio.create_task(core.measure_worker(server))
    async with websockets.serve(server.handle, host, port, max_size=None):
        log.info("running on %s:%d", host, port)
        return await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
