import logging

import websockets
from websockets.server import ServerProtocol

log = logging.getLogger("stemia")


class StemServer:
    async def handle(self, ws: ServerProtocol):
        log.info("client connected: %s", ws.remote_address)
