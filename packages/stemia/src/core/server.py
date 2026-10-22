import logging

import websockets
from websockets.server import ServerProtocol

from core.protocol import MsgType, FLAG_BLOB, FLAG_RESPONSE, decode_frame, decode_command
log = logging.getLogger("stemia")


class StemServer:
        # jobId → Job for cancellation / binary frame routing
        self.pending: dict[str, Job] = {}
    async def send_command(self, ws: ServerProtocol, msg_type: MsgType, data: dict):
        try:
            await ws.send(encode_command(msg_type, data))
        except websockets.ConnectionClosed:
            pass

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
                    match frame.msg_type:
                        case _:
                            log.warning("unknown file/blob msg_type: 0x%02x", frame.msg_type)

                # command frames
                else:
                    try:
                        msg = decode_command(frame)
                    except Exception as e:
                        log.warning("invalid command payload: %s", e)
                        continue

                    match frame.msg_type:
                        case MsgType.JOB_SUBMIT:
                            job_id = msg["jobId"]
                            job = Job(
                                job_id=job_id,
                            )
                            self.pending[job_id] = job

                            await self.send_command(ws, MsgType.JOB_ACCEPTED, {"jobId": job_id})

                            log.info("job %s accepted", job_id)

                        case MsgType.JOB_CANCEL:
                            pass

                        case _:
                            log.warning("unknown command msg_type: 0x%02x", frame.msg_type)

        except websockets.ConnectionClosed:
            pass
        finally:
            log.info("client disconnected: %s", ws.remote_address)
