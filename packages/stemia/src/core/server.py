import logging

import websockets
from websockets.server import ServerProtocol

log = logging.getLogger("stemia")


class StemServer:
    async def handle(self, ws: ServerProtocol):
        log.info("client connected: %s", ws.remote_address)
        try:
            async for raw in ws:
                if not isinstance(raw, bytes):
                    log.warning("unexpected text frame from client")
                    continue

                pass

        except websockets.ConnectionClosed:
            pass
        finally:
            log.info("client disconnected: %s", ws.remote_address)
