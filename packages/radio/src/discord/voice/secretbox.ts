import crypto from 'node:crypto';

import {
  crypto_aead_xchacha20poly1305_ietf_encrypt,
  crypto_aead_xchacha20poly1305_ietf_ABYTES,
  crypto_secretbox_open_easy,
  crypto_secretbox_easy,
  randombytes_buf,
  crypto_box_MACBYTES
} from 'sodium-native';

export function open(buffer: Buffer, nonce: Buffer, secretKey: Buffer) {
  if (buffer) {
    const output = Buffer.allocUnsafe(buffer.length - crypto_box_MACBYTES);

    if (crypto_secretbox_open_easy(output, buffer, nonce, secretKey)) {
      return output;
    }
  }

  return null;
}

export function aeadClose(opusPacket: Buffer, header: Buffer, nonce: Buffer, secretKey: Buffer) {
  const output = Buffer.allocUnsafe(opusPacket.length + crypto_aead_xchacha20poly1305_ietf_ABYTES);
  crypto_aead_xchacha20poly1305_ietf_encrypt(output, opusPacket, header, null, nonce, secretKey);
  return output;
}

export function gcmClose(opusPacket: Buffer, header: Buffer, nonce: Buffer, secretKey: Buffer) {
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, nonce);
  cipher.setAAD(header);
  return Buffer.concat([cipher.update(opusPacket), cipher.final(), cipher.getAuthTag()]);
}

export function close(opusPacket: Buffer, nonce: Buffer, secretKey: Buffer) {
  const output = Buffer.allocUnsafe(opusPacket.length + crypto_box_MACBYTES);
  crypto_secretbox_easy(output, opusPacket, nonce, secretKey);
  return output;
}

export function random(num: number, buffer: Buffer = Buffer.allocUnsafe(num)) {
  randombytes_buf(buffer);
  return buffer;
}
