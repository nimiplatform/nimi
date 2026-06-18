import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { decodePngRgba } from '../src/node/png-rgba.mjs';

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

function crc32(buffer) {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodeRgbPng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const stride = width * 3;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (stride + 1);
    scanlines[outputOffset] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + (y * stride), stride).copy(scanlines, outputOffset + 1);
  }

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND'),
  ]);
}

test('decodes RGB PNG sources into RGBA for atlas ingestion', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nimi2d-png-rgb-'));
  const pngPath = path.join(dir, 'rgb.png');
  const rgb = Uint8Array.from([
    10, 20, 30,
    40, 50, 60,
  ]);
  await writeFile(pngPath, encodeRgbPng(2, 1, rgb));

  const decoded = await decodePngRgba(pngPath);

  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 1);
  assert.deepEqual(Array.from(decoded.rgba), [
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]);
  assert.equal(createHash('sha256').update(Buffer.from(decoded.rgba)).digest('hex').length, 64);
});
