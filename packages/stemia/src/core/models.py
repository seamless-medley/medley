from dataclasses import dataclass, field
from websockets import ServerProtocol

@dataclass
class Job:
    job_id: str
    track_id: str
    input_path: str
    output_dir: str
    ws: ServerProtocol = field(default=None, repr=False)
    priority: str = "normal"
    cancelled: bool = False
    transfer_mode: bool = False
    temp_dir: str | None = None

    def cleanup_temp(self) -> None:
        if self.temp_dir:
            shutil.rmtree(self.temp_dir, ignore_errors=True)
