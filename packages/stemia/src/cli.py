#!/usr/bin/env python3

import argparse
import json
import logging
import os
from collections.abc import Callable
from pathlib import Path

from core.workers.stem import demucs_separate
from core.workers.measure import measure_offset, measure_lufs

from rich.logging import RichHandler
from rich.progress import Progress, BarColumn, TimeElapsedColumn, TaskProgressColumn

logging.basicConfig(level=logging.INFO, handlers=[RichHandler(rich_tracebacks=True)])
log = logging.getLogger("stemia.stem")

# Suppress unauthenticated HF Hub warning — model is pre-cached in Docker; locally rate limits are fine
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
logging.getLogger("httpx2").setLevel(logging.WARNING)


def _make_rich_callback() -> Callable[[dict], None]:
    progress = Progress(
        "[progress.description]{task.description}",
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
    )

    task_id = None
    ctx = progress.__enter__()

    def callback(data: dict) -> None:
        nonlocal task_id
        state = data.get("state")
        audio_length = data.get("audio_length", 1)
        offset = data.get("segment_offset", 0)

        if state == "start" and task_id is None:
            task_id = ctx.add_task("separating", total=audio_length)
        elif state == "end" and task_id is not None:
            ctx.update(task_id, completed=offset)
            if offset >= audio_length:
                progress.__exit__(None, None, None)

    return callback


def main():
    parser = argparse.ArgumentParser(description="stemia - stem separation CLI")
    parser.add_argument("--input", required=True, help="Input audio file path")
    parser.add_argument("--output-dir", required=True, help="Directory to write stems into")
    args = parser.parse_args()

    input_path = os.path.abspath(args.input)
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    track_id = Path(input_path).stem
    stem_path, orig, no_vocals, sr = demucs_separate(input_path, output_dir, track_id, _make_rich_callback())
    log.info("stem output: %s", stem_path)

    log.info("measuring timing offset...")
    offset_seconds = measure_offset(input_path, str(stem_path))
    log.info("offset: %.4fs", offset_seconds)

    log.info("measuring loudness...")
    orig_lufs = measure_lufs(orig, sr)
    stem_lufs = measure_lufs(no_vocals, sr)
    gain_db = orig_lufs - stem_lufs
    log.info("original LUFS: %.1f, stem LUFS: %.1f, gainDb: %.2f", orig_lufs, stem_lufs, gain_db)

    result = {
        "noVocals": {
            "path": str(stem_path),
            "offsetSeconds": round(offset_seconds, 6),
            "gainDb": round(gain_db, 2),
        }
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
