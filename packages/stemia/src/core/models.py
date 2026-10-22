from dataclasses import dataclass, field
from websockets import ServerProtocol

@dataclass
class Job:
    job_id: str
    ws: ServerProtocol = field(default=None, repr=False)
    priority: str = "normal"
