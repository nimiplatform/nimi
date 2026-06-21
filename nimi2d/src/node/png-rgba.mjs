import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const pngSignature = '89504e470d0a1a0a'; // pragma: allowlist secret

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function addByte(value, predictor) {
  return (value + predictor) & 0xff;
}

export async function decodePngRgba(filePath) {
  const buffer = await readFile(filePath);
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Nimi2D PNG decode failed: not a PNG (${filePath})`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error(`Nimi2D PNG decode failed: truncated chunk (${filePath})`);
    }
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const compression = data.readUInt8(10);
      const filter = data.readUInt8(11);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(`Nimi2D PNG decode failed: only non-interlaced 8-bit RGB/RGBA PNG is admitted (${filePath})`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || idatChunks.length === 0) {
    throw new Error(`Nimi2D PNG decode failed: missing IHDR or IDAT (${filePath})`);
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const sourceBytesPerPixel = colorType === 6 ? 4 : 3;
  const sourceStride = width * sourceBytesPerPixel;
  const expected = height * (sourceStride + 1);
  if (inflated.length < expected) {
    throw new Error(`Nimi2D PNG decode failed: inflated data is truncated (${filePath})`);
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  let readOffset = 0;
  let previousRow = new Uint8Array(sourceStride);
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[readOffset];
    readOffset += 1;
    const row = new Uint8Array(sourceStride);
    for (let x = 0; x < sourceStride; x += 1) {
      const raw = inflated[readOffset + x];
      const left = x >= sourceBytesPerPixel ? row[x - sourceBytesPerPixel] : 0;
      const up = y > 0 ? previousRow[x] : 0;
      const upLeft = y > 0 && x >= sourceBytesPerPixel ? previousRow[x - sourceBytesPerPixel] : 0;
      let value;
      if (filterType === 0) {
        value = raw;
      } else if (filterType === 1) {
        value = addByte(raw, left);
      } else if (filterType === 2) {
        value = addByte(raw, up);
      } else if (filterType === 3) {
        value = addByte(raw, Math.floor((left + up) / 2));
      } else if (filterType === 4) {
        value = addByte(raw, paeth(left, up, upLeft));
      } else {
        throw new Error(`Nimi2D PNG decode failed: unsupported filter ${filterType} (${filePath})`);
      }
      row[x] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = x * sourceBytesPerPixel;
      const targetOffset = ((y * width) + x) * 4;
      rgba[targetOffset] = row[sourceOffset];
      rgba[targetOffset + 1] = row[sourceOffset + 1];
      rgba[targetOffset + 2] = row[sourceOffset + 2];
      rgba[targetOffset + 3] = colorType === 6 ? row[sourceOffset + 3] : 255;
    }
    previousRow = row;
    readOffset += sourceStride;
  }

  return { width, height, rgba };
}
