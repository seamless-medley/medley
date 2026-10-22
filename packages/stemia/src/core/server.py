import asyncio
import logging
import os
import tempfile
from pathlib import Path

import websockets
from websockets.server import ServerProtocol

from core.models import Job
from core.protocol import MsgType, FLAG_BLOB, FLAG_RESPONSE, encode_frame, encode_command, decode_frame, decode_command

log = logging.getLogger("stemia")


class StemServer:
    def __init__(self):
        # Separation queues (high drained first)
        self.high_queue: asyncio.Queue[Job] = asyncio.Queue()
        self.normal_queue: asyncio.Queue[Job] = asyncio.Queue()

        # Measurement queue
        self.measure_queue: asyncio.Queue[MeasureTask] = asyncio.Queue()

        # jobId → Job for cancellation / binary frame routing
        self.pending: dict[str, Job] = {}

        # jobId → asyncio.Event, set when file:input binary frame arrives
        self.input_ready: dict[str, asyncio.Event] = {}

        # jobId → accumulated chunks for chunked uploads
        self.input_chunks: dict[str, list[bytes]] = {}

    def discard_job(self, job_id: str) -> None:
        self.pending.pop(job_id, None)
        self.input_ready.pop(job_id, None)

    async def send_command(self, ws: ServerProtocol, msg_type: MsgType, data: dict):
        try:
            await ws.send(encode_command(msg_type, data))
        except websockets.ConnectionClosed:
            pass


    async def fetch_job(self) -> Job:
        while True:
            try:
                return self.high_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                return self.normal_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            await asyncio.sleep(0.05)

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
                        case MsgType.FILE_INPUT_CHUNK:
                            if frame.job_id not in self.input_chunks:
                                self.input_chunks[frame.job_id] = []
                            self.input_chunks[frame.job_id].append(frame.payload)

                        case MsgType.FILE_INPUT_END:
                            chunks = self.input_chunks.pop(frame.job_id, [])

                            if frame.payload:
                                chunks.append(frame.payload)


                            if (job := self.pending.get(frame.job_id)) and job.temp_dir:
                                data = b"".join(chunks)

                                Path(job.input_path).write_bytes(data)
                                event = self.input_ready.get(frame.job_id)

                                if event:
                                    event.set()

                                log.info("job %s received input file (%d bytes)", frame.job_id, len(data))

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
                            priority = msg.get("priority", "normal")
                            transfer_mode = "inputName" in msg and "inputPath" not in msg

                            if transfer_mode:
                                tmp = tempfile.mkdtemp(prefix="stemia_")
                                input_path = os.path.join(tmp, msg["inputName"])
                                output_dir = tmp
                                self.input_ready[job_id] = asyncio.Event()
                            else:
                                tmp = None
                                input_path = msg["inputPath"]
                                output_dir = msg["outputDir"]

                            job = Job(
                                job_id=job_id,
                                track_id=msg["trackId"],
                                input_path=input_path,
                                output_dir=output_dir,
                                ws=ws,
                                priority=priority,
                                transfer_mode=transfer_mode,
                                temp_dir=tmp,
                            )
                            self.pending[job_id] = job

                            await (self.high_queue if priority == "high" else self.normal_queue).put(job)

                            await self.send_command(ws, MsgType.JOB_ACCEPTED, {"jobId": job_id})

                            log.info("job %s accepted", job_id, priority, transfer_mode)

                        case MsgType.JOB_CANCEL:
                            job_id = msg["jobId"]

                            if job := self.pending.get(job_id):
                                job.cancelled = True
                                if event := self.input_ready.get(job_id):
                                    event.set()

                                log.info("job %s marked cancelled", job_id)

                        case _:
                            log.warning("unknown command msg_type: 0x%02x", frame.msg_type)

        except websockets.ConnectionClosed:
            pass
        finally:
            for job in list(self.pending.values()):
                if job.ws is ws:
                    job.cancelled = True
                    if event := self.input_ready.get(job.job_id):
                        event.set()

                    log.info("job %s cancelled: client disconnected", job.job_id)

            log.info("client disconnected: %s", ws.remote_address)
