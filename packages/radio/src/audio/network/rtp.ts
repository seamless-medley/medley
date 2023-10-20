export interface RTPData {
  sequence: number;
	ssrc: number;
	timestamp: number;
}

export function incRTPData(data: RTPData) {
  data.sequence++;
  data.timestamp += 960;

  if (data.sequence >= 2 ** 16) {
    data.sequence = 0;
  }

  if (data.timestamp >= 2 ** 32) {
    data.timestamp = 0;
  }
}

export function createRTPHeader(data: RTPData & { payloadType: number }): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt8(0x80, 0);
  header.writeUInt8(data.payloadType, 1);
  header.writeUIntBE(data.sequence, 2, 2);
  header.writeUIntBE(data.timestamp, 4, 4);
  header.writeUIntBE(data.ssrc, 8, 4);

  return header;
}
