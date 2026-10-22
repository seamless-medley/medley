import json
import struct
from dataclasses import dataclass
from enum import IntEnum
from typing import Any


FLAG_BLOB     = 1 << 7
FLAG_RESPONSE = 1 << 6


class MsgType(IntEnum):
    JOB_SUBMIT        = 0x00
    JOB_CANCEL        = 0x01

    JOB_ACCEPTED      = FLAG_RESPONSE | 0x00
    JOB_PROGRESS      = FLAG_RESPONSE | 0x01
    JOB_DONE          = FLAG_RESPONSE | 0x02
    JOB_ERROR         = FLAG_RESPONSE | 0x03

    FILE_INPUT_CHUNK  = FLAG_BLOB | 0x00
    FILE_INPUT_END    = FLAG_BLOB | 0x01

    FILE_OUTPUT_CHUNK = FLAG_BLOB | FLAG_RESPONSE | 0x00
    FILE_OUTPUT_END   = FLAG_BLOB | FLAG_RESPONSE | 0x01


@dataclass
class Frame:
    msg_type: MsgType
    job_id: str       # can be empty
    payload: bytes


def encode_frame(msg_type: MsgType, job_id: str, payload: bytes) -> bytes:
    job_id_bytes = job_id.encode()
    return struct.pack(">BI", msg_type, len(job_id_bytes)) + job_id_bytes + payload


def encode_command(msg_type: MsgType, data: dict[str, Any]) -> bytes:
    return encode_frame(msg_type, "", json.dumps(data).encode())


def decode_frame(data: bytes) -> Frame:
    if len(data) < 5:
        raise ValueError("frame too short")

    msg_type = MsgType(data[0])
    (job_id_len,) = struct.unpack_from(">I", data, 1)

    offset = 5 + job_id_len
    if len(data) < offset:
        raise ValueError("frame truncated")

    job_id = data[5:offset].decode()
    payload = data[offset:]

    return Frame(msg_type=msg_type, job_id=job_id, payload=payload)


def decode_command(frame: Frame) -> dict[str, Any]:
    """Decode payload of a command frame as JSON."""
    return json.loads(frame.payload.decode())
