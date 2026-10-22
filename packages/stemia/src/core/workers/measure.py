import asyncio
import logging
from pathlib import Path

import av
import numpy as np
import torch
import torchaudio
from scipy.signal import correlate

from core.protocol import MsgType
from ..server import StemServer

log = logging.getLogger("stemia")


def _decode_mono_16k(path: str) -> np.ndarray:
    chunks = []
    with av.open(path) as container:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)

        for frame in container.decode(audio=0):
            for rf in resampler.resample(frame):
                chunks.append(rf.to_ndarray()[0])

        for rf in resampler.resample(None):
            chunks.append(rf.to_ndarray()[0])

    return np.concatenate(chunks) if chunks else np.array([], dtype=np.float32)


def measure_offset(original_path: str, stem_path: str) -> float:
    sr = 16000
    window   = sr * 5   # 5-second correlation window
    step     = sr * 2   # scan forward in 2-second steps looking for stem energy
    scan_max = sr * 30  # don't scan past 30s

    # Observed MP3 encode/decode roundtrip offset range is ~0.025–0.050s.
    # Used as fallback when no usable stem window is found (e.g. pure a-cappella track).
    fallback_offset = 0.025

    orig_full = _decode_mono_16k(original_path)
    stem_full = _decode_mono_16k(stem_path)

    # Find the first 5s window within the first 30s where the stem has enough energy
    # to correlate reliably. Tracks that open with a pure vocal intro have a near-silent
    # stem (no_vocals) at the start — cross-correlation on near-zero signal is unreliable.
    energy_threshold = 0.01  # fraction of peak RMS; below this the window is too quiet
    peak_rms = float(np.sqrt(np.mean(stem_full ** 2)) + 1e-9)
    start = None
    pos = 0
    while pos + window <= min(scan_max, len(stem_full)):
        chunk = stem_full[pos:pos + window]
        if np.sqrt(np.mean(chunk ** 2)) / peak_rms >= energy_threshold:
            start = pos
            break
        pos += step

    if start is None:
        return fallback_offset

    orig = orig_full[start:start + window]
    stem = stem_full[start:start + window]

    # normalize so amplitude differences don't skew the correlation peak
    # +1e-9 avoids division by zero on silent audio
    orig = orig / (np.max(np.abs(orig)) + 1e-9)
    stem = stem / (np.max(np.abs(stem)) + 1e-9)

    # full cross-correlation: output length = len(orig) + len(stem) - 1
    corr = correlate(orig, stem, mode="full")
    # argmax gives the index of best alignment; subtract (len(stem)-1) to get signed lag in samples
    lag = np.argmax(corr) - (len(stem) - 1)
    return float(lag) / sr  # positive = stem starts later than original


def measure_lufs(wav: torch.Tensor, sr: int) -> float:
    loudness = torchaudio.transforms.Loudness(sr)
    return loudness(wav).item()


def _measure(input_path: str, stem_path: str, orig, no_vocals, sr: int):
    offset = measure_offset(input_path, stem_path)
    orig_lufs = measure_lufs(orig, sr)
    stem_lufs = measure_lufs(no_vocals, sr)
    return offset, orig_lufs, stem_lufs


async def measure_worker(server: StemServer) -> None:
    """Runs offset+loudness measurement; overlaps with next stem job."""
    loop = asyncio.get_event_loop()
    while True:
        task = await server.measure_queue.get()
        job = task.job

        if job.cancelled:
            log.info("job %s cancelled before measurement", job.job_id)
            server.discard_job(job.job_id)
            job.cleanup_temp()
            continue

        log.info("measuring job %s", job.job_id)

        try:
            offset_seconds, orig_lufs, stem_lufs = await loop.run_in_executor(
                None, _measure, task.input_path, task.stem_path, task.orig, task.no_vocals, task.sr
            )

            gain_db = orig_lufs - stem_lufs
            result = {
                "noVocals": {
                    "path": task.stem_path if not job.transfer_mode else None,
                    "offsetSeconds": round(offset_seconds, 6),
                    "gainDb": round(gain_db, 2),
                }
            }

            log.info("job %s done: offset=%.4fs gainDb=%.2f", job.job_id, offset_seconds, gain_db)

            if job.ws:
                await server.send_command(job.ws, MsgType.JOB_DONE, {"jobId": job.job_id, "trackId": job.track_id, "result": result})

                if job.transfer_mode:
                    payload = Path(task.stem_path).read_bytes()
                    await server.send_file_chunked(job.ws, job.job_id, payload)

            server.discard_job(job.job_id)
            job.cleanup_temp()

        except Exception as e:
            log.exception("job %s failed during measurement", job.job_id)

            if job.ws:
                await server.send_command(job.ws, MsgType.JOB_ERROR, {"jobId": job.job_id, "trackId": job.track_id, "error": str(e)})

            server.discard_job(job.job_id)
            job.cleanup_temp()
