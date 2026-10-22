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

                try:
                    frame = decode_frame(raw)
                except Exception as e:
                    log.warning("invalid binary frame: %s", e)
                    continue

                if frame.msg_type & FLAG_RESPONSE:
                    log.warning("malformed request: response flag set in client frame 0x%02x", frame.msg_type)
                    continue

                # file/blob frames
                if frame.msg_type & FLAG_BLOB:
                    pass
                # command frames
                else:
                    pass

        except websockets.ConnectionClosed:
            pass
        finally:
            log.info("client disconnected: %s", ws.remote_address)
