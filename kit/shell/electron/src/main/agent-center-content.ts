import path from 'node:path';
import sharp from 'sharp';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export function backgroundMimeForPath(filePath: string): ImageMime | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return undefined;
}

export async function decodeImageDimensions(
  bytes: Uint8Array,
  mime: ImageMime,
  maxPixels: number,
): Promise<{ readonly width: number; readonly height: number } | undefined> {
  const expectedFormat = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpeg' : 'webp';
  if (!hasCompleteImageContainer(bytes, mime)) return undefined;
  try {
    const image = sharp(Buffer.from(bytes), {
      failOn: 'warning',
      limitInputPixels: maxPixels * maxPixels,
      pages: 1,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat) return undefined;
    const decoded = await image.clone().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = decoded.info;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined;
    if (width > maxPixels || height > maxPixels || decoded.data.byteLength === 0) return undefined;
    return { width, height };
  } catch {
    return undefined;
  }
}

function hasCompleteImageContainer(bytes: Uint8Array, mime: ImageMime): boolean {
  if (mime === 'image/png') return hasCompletePngContainer(bytes);
  if (mime === 'image/jpeg') {
    return bytes.byteLength >= 4
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[bytes.byteLength - 2] === 0xff
      && bytes[bytes.byteLength - 1] === 0xd9;
  }
  if (bytes.byteLength < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return false;
  return readU32(bytes, 4, true) + 8 === bytes.byteLength;
}

function hasCompletePngContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 45 || ascii(bytes, 0, 8) !== '\u0089PNG\r\n\u001a\n') return false;
  let offset = 8;
  let index = 0;
  let sawImageData = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) return false;
    const length = readU32(bytes, offset, false);
    const typeStart = offset + 4;
    const dataEnd = typeStart + 4 + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.byteLength) return false;
    const chunkType = ascii(bytes, typeStart, typeStart + 4);
    if (index === 0 && (chunkType !== 'IHDR' || length !== 13)) return false;
    if (readU32(bytes, dataEnd, false) !== crc32(bytes.subarray(typeStart, dataEnd))) return false;
    if (chunkType === 'IDAT') sawImageData = true;
    if (chunkType === 'IEND') return length === 0 && sawImageData && chunkEnd === bytes.byteLength;
    offset = chunkEnd;
    index += 1;
  }
  return false;
}

function readU32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateVrmGlb(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength < 20 || ascii(bytes, 0, 4) !== 'glTF') {
    return 'VRM must be a GLB file with the glTF magic header.';
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 2) return 'VRM GLB version must be 2.';
  if (view.getUint32(8, true) !== bytes.byteLength) {
    return 'VRM GLB declared length must match the file length.';
  }

  let offset = 12;
  let jsonChunk: Uint8Array | undefined;
  let sawBin = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) return 'VRM GLB chunk header is truncated.';
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkLength === 0 || chunkLength % 4 !== 0 || chunkEnd > bytes.byteLength) {
      return 'VRM GLB chunk length or alignment is invalid.';
    }
    if (!jsonChunk) {
      if (chunkType !== 0x4e4f534a) return 'VRM GLB must begin with a JSON chunk.';
      jsonChunk = bytes.subarray(chunkStart, chunkEnd);
    } else if (chunkType === 0x004e4942 && !sawBin) {
      sawBin = true;
    } else {
      return 'VRM GLB contains an unsupported or duplicate chunk.';
    }
    offset = chunkEnd;
  }
  if (!jsonChunk || offset !== bytes.byteLength) return 'VRM GLB must contain one complete JSON chunk.';

  let root: unknown;
  try {
    root = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonChunk).trimEnd());
  } catch {
    return 'VRM GLB JSON chunk is malformed.';
  }
  if (!isObject(root)) return 'VRM GLB JSON chunk must be an object.';
  if (!isObject(root.asset) || root.asset.version !== '2.0') {
    return 'VRM GLB glTF asset.version must be 2.0.';
  }
  if (!Array.isArray(root.extensionsUsed) || root.extensionsUsed.some((entry) => typeof entry !== 'string')) {
    return 'VRM GLB extensionsUsed must be a string array.';
  }
  const extensions = isObject(root.extensions) ? root.extensions : {};
  const hasVrm1 = root.extensionsUsed.includes('VRMC_vrm')
    && isObject(extensions.VRMC_vrm)
    && isVrmSpecVersion(extensions.VRMC_vrm.specVersion);
  const hasVrm0 = root.extensionsUsed.includes('VRM')
    && isObject(extensions.VRM)
    && isVrmSpecVersion(extensions.VRM.specVersion);
  if (!hasVrm1 && !hasVrm0) {
    return 'VRM GLB must declare a versioned VRMC_vrm or VRM extension.';
  }
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function isVrmSpecVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?$/u.test(value);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
