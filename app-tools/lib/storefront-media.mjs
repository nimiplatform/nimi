// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042b
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);

export const STOREFRONT_CATEGORIES = Object.freeze([
  'companions-worlds',
  'lifestyle',
  'writing-notes',
  'design-diagrams',
  'audio-music',
  'video-media',
  'research-learning',
  'productivity-automation',
  'developer-tools',
]);

export const STOREFRONT_IMAGE_MAX_BYTES = 512 * 1024;
export const STOREFRONT_ARCHIVE_MAX_BYTES = 8 * 1024 * 1024;
export const STOREFRONT_COVER_BOUNDS = Object.freeze({ minW: 800, maxW: 2560, minH: 450, maxH: 1600 });
export const STOREFRONT_GALLERY_BOUNDS = Object.freeze({ minW: 640, maxW: 2560, minH: 360, maxH: 1600 });

export const STOREFRONT_LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
export const STOREFRONT_GALLERY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
export const STOREFRONT_SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

export function storefrontMediaExtension(mediaType) {
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/png') return 'png';
  throw new Error(`Unsupported storefront image media type: ${mediaType}`);
}

export function inspectStaticStorefrontImage(bytes, bounds, label = 'storefront image') {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > STOREFRONT_IMAGE_MAX_BYTES) {
    throw new Error(`${label} must be a nonempty static WebP or PNG of at most ${STOREFRONT_IMAGE_MAX_BYTES} bytes`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    let offset = 8;
    let width = 0;
    let height = 0;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length) throw new Error(`${label} PNG chunk is truncated`);
      if (type === 'acTL') throw new Error(`${label} animated PNG (APNG) is not allowed`);
      if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw new Error(`${label} PNG header is invalid`);
      if (type === 'IHDR') {
        if (offset !== 8) throw new Error(`${label} PNG has more than one header`);
        width = bytes.readUInt32BE(offset + 8);
        height = bytes.readUInt32BE(offset + 12);
      }
      offset += length + 12;
      if (type === 'IEND') {
        ended = length === 0 && offset === bytes.length;
        break;
      }
    }
    if (!ended) throw new Error(`${label} PNG is truncated or has trailing bytes`);
    assertImageBounds(width, height, bounds, label);
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height) throw new Error(`${label} PNG dimensions are inconsistent`);
    return { media_type: 'image/png', width, height, size: bytes.length, sha256 };
  }

  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const riffSize = bytes.readUInt32LE(4);
    if (riffSize + 8 !== bytes.length) throw new Error(`${label} WebP RIFF size does not match file length`);
    let offset = 12;
    let width = 0;
    let height = 0;
    let hasBitstream = false;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error(`${label} WebP chunk header is truncated`);
      const type = bytes.toString('ascii', offset, offset + 4);
      const chunkSize = bytes.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + chunkSize;
      const paddedEnd = dataEnd + (chunkSize & 1);
      if (paddedEnd > bytes.length) throw new Error(`${label} WebP chunk ${type} is truncated`);
      if (type === 'ANIM' || type === 'ANMF') throw new Error(`${label} animated WebP is not allowed`);
      if (type === 'VP8X') {
        if (offset !== 12 || chunkSize !== 10) throw new Error(`${label} WebP VP8X chunk is invalid`);
        const flags = bytes[dataStart];
        if ((flags & 0x02) !== 0) throw new Error(`${label} animated WebP (VP8X animation flag) is not allowed`);
        width = 1 + (bytes[dataStart + 4] | (bytes[dataStart + 5] << 8) | (bytes[dataStart + 6] << 16));
        height = 1 + (bytes[dataStart + 7] | (bytes[dataStart + 8] << 8) | (bytes[dataStart + 9] << 16));
      } else if (type === 'VP8 ' || type === 'VP8L') {
        const frame = bytes.subarray(dataStart, dataEnd);
        const dimensions = webpFrameDimensions(type, frame, label);
        if (hasBitstream || (width !== 0 && (width !== dimensions.width || height !== dimensions.height))) {
          throw new Error(`${label} WebP dimensions are inconsistent`);
        }
        width = dimensions.width;
        height = dimensions.height;
        hasBitstream = true;
      }
      offset = paddedEnd;
    }
    if (!hasBitstream || width <= 0 || height <= 0) throw new Error(`${label} WebP is missing image bitstream or dimensions`);
    assertImageBounds(width, height, bounds, label);
    const { Transformer } = require('@napi-rs/image');
    try {
      const image = new Transformer(bytes);
      const pixels = image.rawPixelsSync();
      const decoded = image.metadataSync();
      if (decoded.width !== width || decoded.height !== height || !pixels.length) throw new Error('invalid decoded image');
    } catch (cause) {
      throw new Error(`${label} WebP pixels could not be decoded`, { cause });
    }
    return { media_type: 'image/webp', width, height, size: bytes.length, sha256 };
  }

  throw new Error(`${label} must be a static WebP or PNG image`);
}

function webpFrameDimensions(type, frame, label) {
  if (type === 'VP8L') {
    if (frame.length < 5 || frame[0] !== 0x2f) throw new Error(`${label} WebP VP8L header is invalid`);
    const bits = frame.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (frame.length < 10 || (frame[0] & 1) !== 0 || frame[3] !== 0x9d || frame[4] !== 1 || frame[5] !== 0x2a) {
    throw new Error(`${label} WebP VP8 keyframe header is invalid`);
  }
  return { width: frame.readUInt16LE(6) & 0x3fff, height: frame.readUInt16LE(8) & 0x3fff };
}

function assertImageBounds(width, height, bounds, label) {
  if (width < bounds.minW || width > bounds.maxW || height < bounds.minH || height > bounds.maxH) {
    throw new Error(`${label} dimensions ${width}x${height} are outside allowed bounds (${bounds.minW}-${bounds.maxW} x ${bounds.minH}-${bounds.maxH})`);
  }
}

export function collectStorefrontImageRefs(media) {
  const refs = [];
  if (!media) return refs;
  if (media.cover) {
    refs.push(media.cover.default);
    for (const ref of Object.values(media.cover.locales || {})) refs.push(ref);
  }
  for (const item of media.gallery || []) {
    refs.push(item.default);
    for (const ref of Object.values(item.locales || {})) refs.push(ref);
  }
  return refs;
}
