import asyncio
import logging
import os
from collections.abc import Callable
from pathlib import Path

import torch
import websockets
from demucs.api import Separator
from demucs.audio import save_audio

from core.protocol import MsgType, encode_command
from ..server import StemServer


log = logging.getLogger("stemia")


def demucs_separate(
    input_path: str,
    output_dir: str,
    track_id: str,
    progress_callback: Callable[[dict], None] | None = None,
) -> tuple[Path, torch.Tensor, torch.Tensor, int]:
    sep = Separator(
        model="htdemucs",
        progress=False,
        callback=progress_callback,
    )

    log.info("separating stems: %s", input_path)

    orig, stems = sep.separate_audio_file(Path(input_path))

    # remove vocals tensor from the original tensor
    no_vocals = orig - stems["vocals"]

    stem_path = Path(output_dir) / track_id / "no_vocals.mp3"
    stem_path.parent.mkdir(parents=True, exist_ok=True)

    save_audio(no_vocals, stem_path, samplerate=sep.samplerate)

    return stem_path, orig, no_vocals, sep.samplerate


def make_service_callback(job, loop: asyncio.AbstractEventLoop) -> Callable:
    import time
    interval = 1.0 / 10
    last_sent: list[float] = [0.0]

    def callback(data: dict) -> None:
        now = time.monotonic()
        state = data.get("state")
        audio_length = data.get("audio_length", 1)
        segment_offset = data.get("segment_offset", 0)

        if state == "end" and (now - last_sent[0] < interval) and segment_offset < audio_length:
            return

        last_sent[0] = now

        if job.ws:
            progress_pct = round(segment_offset / audio_length * 100, 1) if audio_length else 0
            frame = encode_command(MsgType.JOB_PROGRESS, {
                "jobId": job.job_id,
                "stage": "separating",
                "progress": progress_pct,
            })

            async def _send(ws=job.ws, f=frame):
                try:
                    await ws.send(f)
                except websockets.ConnectionClosed:
                    pass

            loop.call_soon_threadsafe(asyncio.ensure_future, _send())

    return callback


async def stem_worker(server: StemServer):
    """Runs demucs sequentially; hands off to measure worker when done."""
    loop = asyncio.get_event_loop()
    while True:
        job = await server.fetch_job()

        if job.cancelled:
            server.pending.pop(job.job_id, None)
            log.info("job %s cancelled before separation", job.job_id)
            job.cleanup_temp()
            continue

        if job.transfer_mode:
            if event := server.input_ready.get(job.job_id):
                await event.wait()

            if job.cancelled:
                server.pending.pop(job.job_id, None)
                log.info("job %s cancelled before separation", job.job_id)
                job.cleanup_temp()
                continue

        server.pending.pop(job.job_id, None)

        log.info("separating job %s: %s", job.job_id, job.input_path)

        try:
            os.makedirs(job.output_dir, exist_ok=True)

            if job.ws:
                await server.send_command(job.ws, MsgType.JOB_PROGRESS, {"jobId": job.job_id, "stage": "separating"})

            stem_path, orig, no_vocals, sr = await loop.run_in_executor(
                None, demucs_separate, job.input_path, job.output_dir, job.track_id, make_service_callback(job, loop)
            )

            if job.cancelled:
                log.info("job %s cancelled after separation", job.job_id)
                job.cleanup_temp()
                continue

            if job.ws:
                await server.send_command(job.ws, MsgType.JOB_PROGRESS, {"jobId": job.job_id, "stage": "measuring"})

        except Exception as e:
            log.exception("job %s failed during separation", job.job_id)
            if job.ws:
                await server.send_command(job.ws, MsgType.JOB_ERROR, {"jobId": job.job_id, "trackId": job.track_id, "error": str(e)})
            server.discard_job(job.job_id)
            job.cleanup_temp()
