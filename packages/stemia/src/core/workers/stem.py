import asyncio
from ..server import StemServer


log = logging.getLogger("stemia")

async def stem_worker(server: StemServer):
    loop = asyncio.get_event_loop()
    while True:
        job = await server.fetch_job()
        server.pending.pop(job.job_id, None)
