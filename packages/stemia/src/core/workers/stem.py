import asyncio
import logging
import os
from collections.abc import Callable
from pathlib import Path

import torch
import websockets
from demucs.api import Separator
from demucs.audio import save_audio

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

async def stem_worker(server: StemServer):
    loop = asyncio.get_event_loop()
    while True:
        job = await server.fetch_job()

        if job.cancelled:
            server.pending.pop(job.job_id, None)
            log.info("job %s cancelled before separation", job.job_id)
            job.cleanup_temp()
            continue
        server.pending.pop(job.job_id, None)
