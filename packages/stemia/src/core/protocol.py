from enum import IntEnum


class MsgType(IntEnum):
    pass



def decode_frame(data: bytes):
    if len(data) < 5:
        raise ValueError("frame too short")

    msg_type = MsgType(data[0])
