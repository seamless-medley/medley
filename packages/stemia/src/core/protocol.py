from dataclasses import dataclass
from enum import IntEnum


class MsgType(IntEnum):
    JOB_SUBMIT        = 0x00
    JOB_CANCEL        = 0x01



@dataclass
class Frame:
    msg_type: MsgType
    job_id: str       # can be empty
    payload: bytes

def decode_frame(data: bytes) -> Frame:
    if len(data) < 5:
        raise ValueError("frame too short")

    msg_type = MsgType(data[0])
