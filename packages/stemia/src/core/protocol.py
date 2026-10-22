def decode_frame(data: bytes):
    if len(data) < 5:
        raise ValueError("frame too short")
