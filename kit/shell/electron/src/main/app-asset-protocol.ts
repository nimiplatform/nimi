import { randomBytes } from 'node:crypto';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import type { NimiElectronLocalAppHost, NimiElectronLocalAppRecord } from './local-app-host.js';
import { NimiElectronShellHostError, type NimiElectronIpcMainInvokeEvent } from './types.js';

export const NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME = 'nimi-app-asset';
export const NIMI_ELECTRON_APP_ASSET_PROTOCOL_REGISTRATION = Object.freeze({
  scheme: NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME,
  privileges: Object.freeze({ standard: true, secure: true, corsEnabled: true, supportFetchAPI: true, stream: true }),
});

const SAFE_MEDIA_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/wav', 'audio/mpeg', 'audio/ogg',
  'video/mp4', 'video/webm',
]);
const MAX_CONTAINER_SIGNATURE_BYTES = 64 * 1024;
const MAX_HANDLE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TTL_MS = MAX_HANDLE_TTL_MS;

type PinnedAsset = {
  readonly relativePath: string;
  readonly rendererId: number;
  readonly expiresAt: number;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
};

export type NimiElectronLocalAppAssetMediaHost = {
  readonly open: (relativePath: string, rendererId: number) => Promise<{ readonly url: string; readonly handle: string }>;
  readonly revoke: (handle: string, rendererId: number) => boolean;
  readonly invalidatePath: (relativePath: string) => void;
  readonly invalidateRenderer: (rendererId: number) => void;
  readonly invalidateAll: () => void;
  readonly close: () => void;
};

export type NimiElectronAppAssetMediaPlatform = {
  readonly protocol: {
    registerSchemesAsPrivileged(entries: typeof NIMI_ELECTRON_APP_ASSET_PROTOCOL_REGISTRATION[]): void;
    handle(scheme: string, handler: (request: { readonly url: string; readonly headers: Headers }) => Promise<Response>): void;
    unhandle(scheme: string): void;
  };
  readonly webRequest: {
    onBeforeRequest(
      filter: { readonly urls: string[] },
      listener: ((
        details: { readonly url: string; readonly webContentsId?: number; readonly resourceType?: string },
        callback: (response: { readonly cancel: boolean }) => void,
      ) => void) | null,
    ): void;
  };
  readonly webContents: {
    fromId(rendererId: number): {
      readonly on: (
        event: 'did-start-navigation',
        listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
      ) => unknown;
      readonly once: (event: 'destroyed', listener: () => void) => unknown;
    } | undefined;
  };
};

export function registerNimiElectronAppAssetProtocolScheme(
  protocol: NimiElectronAppAssetMediaPlatform['protocol'],
): void {
  protocol.registerSchemesAsPrivileged([NIMI_ELECTRON_APP_ASSET_PROTOCOL_REGISTRATION]);
}

export function createNimiElectronLocalAppAssetMediaHost(input: {
  readonly localAppHost: NimiElectronLocalAppHost;
  readonly platform: NimiElectronAppAssetMediaPlatform;
  readonly ttlMs?: number;
  readonly now?: () => number;
}): NimiElectronLocalAppAssetMediaHost {
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_HANDLE_TTL_MS) throw new Error('App asset handle TTL is invalid');
  const now = input.now ?? Date.now;
  const handles = new Map<string, PinnedAsset>();
  const approved = new Map<string, number>();
  const observedRenderers = new Set<number>();

  const deleteHandle = (handle: string): boolean => {
    approved.delete(handle);
    return handles.delete(handle);
  };

  const invalidateRenderer = (rendererId: number): void => {
    for (const [handle, pin] of handles) if (pin.rendererId === rendererId) deleteHandle(handle);
  };
  const invalidateAll = (): void => { handles.clear(); approved.clear(); };
  const cleanup = (): void => {
    const time = now();
    for (const [handle, pin] of handles) if (pin.expiresAt <= time) deleteHandle(handle);
  };

  const { protocol, webRequest, webContents } = input.platform;
  const beforeRequest = (
    details: { readonly url: string; readonly webContentsId?: number; readonly resourceType?: string },
    callback: (response: { readonly cancel: boolean }) => void,
  ): void => {
    const handle = parseHandle(details.url);
    cleanup();
    const pin = handle ? handles.get(handle) : undefined;
    const allowed = Boolean(pin)
      && pin!.rendererId === details.webContentsId
      && details.resourceType !== 'mainFrame'
      && details.resourceType !== 'subFrame';
    if (allowed && handle) approved.set(handle, (approved.get(handle) ?? 0) + 1);
    callback({ cancel: !allowed });
  };
  webRequest.onBeforeRequest({ urls: [`${NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME}://media/*`] }, beforeRequest);

  protocol.handle(NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME, async (request) => {
    const handle = parseHandle(request.url);
    cleanup();
    const pin = handle ? handles.get(handle) : undefined;
    const approvalCount = handle ? approved.get(handle) ?? 0 : 0;
    if (!handle || !pin || approvalCount < 1) return mediaResponse(403, 'asset handle is not admitted');
    if (approvalCount === 1) approved.delete(handle); else approved.set(handle, approvalCount - 1);
    const requested = parseHttpRange(request.headers.get('range'), pin.sizeBytes);
    if (requested === null) return rangeNotSatisfiable(pin.sizeBytes);
    const offset = requested?.offset ?? 0;
    const length = requested?.length ?? pin.sizeBytes;
    let opened: NimiElectronLocalAppRecord;
    try {
      opened = await input.localAppHost.assetReadOpen({ relativePath: pin.relativePath, offset, ...(length > 0 ? { length } : {}) });
    } catch {
      deleteHandle(handle);
      return mediaResponse(404, 'asset is unavailable');
    }
    const asset = opened.asset as NimiElectronLocalAppRecord;
    const range = opened.range as NimiElectronLocalAppRecord;
    if (asset.relativePath !== pin.relativePath || asset.mediaType !== pin.mediaType
      || asset.sizeBytes !== pin.sizeBytes || asset.sha256 !== pin.sha256
      || range.offset !== offset || range.length !== length || range.totalSize !== pin.sizeBytes) {
      deleteHandle(handle);
      await input.localAppHost.assetReadClose({ streamId: String(opened.streamId) }).catch(() => undefined);
      return mediaResponse(409, 'asset metadata changed');
    }
    const streamId = String(opened.streamId);
    let cancelled = false;
    let closing: Promise<unknown> | undefined;
    const closeStream = (): Promise<unknown> => {
      closing ??= input.localAppHost.assetReadClose({ streamId }).catch(() => undefined);
      return closing;
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await input.localAppHost.assetReadNext({ streamId });
          if (cancelled) return;
          if (next.completed) {
            controller.close();
            await closeStream();
          } else {
            controller.enqueue(next.bodyChunk);
          }
        } catch (error) {
          if (!cancelled) {
            deleteHandle(handle);
            controller.error(error);
          }
          await closeStream();
        }
      },
      async cancel() {
        cancelled = true;
        await closeStream();
      },
    });
    const headers = new Headers({
      'content-type': pin.mediaType,
      'content-length': String(length),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (requested) headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${pin.sizeBytes}`);
    return new Response(body, { status: requested ? 206 : 200, headers });
  });

  return Object.freeze({
    async open(relativePath, rendererId) {
      cleanup();
      if (!Number.isSafeInteger(rendererId) || rendererId <= 0) throw mediaHostError('forbidden-renderer-access');
      const asset = await input.localAppHost.assetStat({ relativePath });
      const mediaType = String(asset.mediaType ?? '');
      const sizeBytes = Number(asset.sizeBytes);
      const sha256 = String(asset.sha256 ?? '');
      if (!SAFE_MEDIA_TYPES.has(mediaType) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
        || !/^sha256:[0-9a-f]{64}$/u.test(sha256)) throw mediaHostError('invalid-payload');
      const signatureBytes = signatureReadBytes(mediaType);
      const prefixLength = Math.min(sizeBytes, signatureBytes);
      const prefixRead = await input.localAppHost.assetReadOpen({ relativePath, offset: 0, length: prefixLength });
      const prefixAsset = prefixRead.asset as NimiElectronLocalAppRecord;
      const prefixRange = prefixRead.range as NimiElectronLocalAppRecord;
      if (prefixAsset.relativePath !== relativePath || prefixAsset.mediaType !== mediaType
        || prefixAsset.sizeBytes !== sizeBytes || prefixAsset.sha256 !== sha256
        || prefixRange.offset !== 0 || prefixRange.length !== prefixLength
        || prefixRange.totalSize !== sizeBytes) {
        await input.localAppHost.assetReadClose({ streamId: String(prefixRead.streamId) }).catch(() => undefined);
        throw mediaHostError('integrity-failure');
      }
      const prefix = await collectPrefix(input.localAppHost, prefixRead, signatureBytes);
      if (!validSignature(mediaType, prefix)) throw mediaHostError('invalid-payload');
      observeRenderer(webContents, rendererId, observedRenderers, invalidateRenderer);
      const handle = randomBytes(32).toString('base64url');
      handles.set(handle, Object.freeze({ relativePath, rendererId, expiresAt: now() + ttlMs, mediaType, sizeBytes, sha256 }));
      return Object.freeze({ url: `${NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME}://media/${handle}`, handle });
    },
    revoke(handle, rendererId) {
      const pin = handles.get(handle);
      if (!pin || pin.rendererId !== rendererId) return false;
      return deleteHandle(handle);
    },
    invalidatePath(relativePath) { for (const [handle, pin] of handles) if (pin.relativePath === relativePath) deleteHandle(handle); },
    invalidateRenderer,
    invalidateAll,
    close() {
      invalidateAll();
      protocol.unhandle(NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME);
      webRequest.onBeforeRequest({ urls: [`${NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME}://media/*`] }, null);
    },
  });
}

export function isElectronLocalAppAssetMediaCommand(command: string): boolean {
  return command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaOpen']
    || command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaRevoke'];
}

export async function dispatchElectronLocalAppAssetMediaCommand(input: {
  readonly host?: NimiElectronLocalAppAssetMediaHost;
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly event: NimiElectronIpcMainInvokeEvent;
}): Promise<unknown> {
  const rendererId = input.event.sender?.id;
  if (!input.host || !Number.isSafeInteger(rendererId) || Number(rendererId) <= 0) throw mediaHostError('forbidden-renderer-access');
  if (input.command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaOpen']) {
    if (Object.keys(input.payload).join('|') !== 'relativePath' || typeof input.payload.relativePath !== 'string') throw mediaHostError('invalid-payload');
    return input.host.open(input.payload.relativePath, Number(rendererId));
  }
  if (Object.keys(input.payload).join('|') !== 'handle' || typeof input.payload.handle !== 'string') throw mediaHostError('invalid-payload');
  return { revoked: input.host.revoke(input.payload.handle, Number(rendererId)) };
}

async function collectPrefix(host: NimiElectronLocalAppHost, opened: NimiElectronLocalAppRecord, maximum: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const streamId = String(opened.streamId);
  try {
    while (size < maximum) {
      const next = await host.assetReadNext({ streamId });
      if (next.completed) break;
      chunks.push(next.bodyChunk);
      size += next.bodyChunk.byteLength;
      if (size > maximum) throw mediaHostError('invalid-payload');
    }
  } finally {
    await host.assetReadClose({ streamId }).catch(() => undefined);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function observeRenderer(
  webContents: NimiElectronAppAssetMediaPlatform['webContents'],
  rendererId: number,
  observed: Set<number>,
  invalidate: (id: number) => void,
): void {
  if (observed.has(rendererId)) return;
  const contents = webContents.fromId(rendererId);
  if (!contents) throw mediaHostError('forbidden-renderer-access');
  observed.add(rendererId);
  contents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) invalidate(rendererId);
  });
  contents.once('destroyed', () => { observed.delete(rendererId); invalidate(rendererId); });
}

function parseHandle(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== `${NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME}:` || url.hostname !== 'media'
      || url.search || url.hash || !/^\/[A-Za-z0-9_-]{43}$/u.test(url.pathname)) return undefined;
    return url.pathname.slice(1);
  } catch { return undefined; }
}

function parseHttpRange(value: string | null, total: number): { readonly offset: number; readonly length: number } | undefined | null {
  if (value === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2]) || value.includes(',')) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, total);
    return { offset: total - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) return null;
  return { offset: start, length: Math.min(end, total - 1) - start + 1 };
}

function validSignature(mediaType: string, bytes: Uint8Array): boolean {
  const ascii = (offset: number, text: string) => text.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (mediaType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (mediaType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === 'image/gif') return bytes.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'));
  if (mediaType === 'image/webp') return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
  if (mediaType === 'audio/wav') return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WAVE');
  if (mediaType === 'audio/ogg') return bytes.length >= 4 && ascii(0, 'OggS')
    && (findAscii(bytes, 'OpusHead') >= 0 || findBytes(bytes, Uint8Array.of(1, 118, 111, 114, 98, 105, 115)) >= 0);
  if (mediaType === 'audio/mpeg') return bytes.length >= 3 && (ascii(0, 'ID3') || hasMpegAudioFrame(bytes));
  if (mediaType === 'video/mp4') return hasCompatibleMp4Ftyp(bytes);
  if (mediaType === 'video/webm') return bytes.length >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    && findAscii(bytes, 'webm') >= 0;
  return false;
}

function signatureReadBytes(mediaType: string): number {
  if (mediaType === 'image/png') return 8;
  if (mediaType === 'image/jpeg') return 3;
  if (mediaType === 'image/gif') return 6;
  if (mediaType === 'image/webp' || mediaType === 'audio/wav') return 12;
  return MAX_CONTAINER_SIGNATURE_BYTES;
}

function findAscii(bytes: Uint8Array, value: string): number {
  return findBytes(bytes, Uint8Array.from(value, (char) => char.charCodeAt(0)));
}

function findBytes(bytes: Uint8Array, value: Uint8Array): number {
  if (value.byteLength === 0 || value.byteLength > bytes.byteLength) return -1;
  outer: for (let offset = 0; offset <= bytes.byteLength - value.byteLength; offset += 1) {
    for (let index = 0; index < value.byteLength; index += 1) {
      if (bytes[offset + index] !== value[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function hasMpegAudioFrame(bytes: Uint8Array): boolean {
  for (let offset = 0; offset + 3 < bytes.byteLength; offset += 1) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1]!;
    const third = bytes[offset + 2]!;
    const version = (second >> 3) & 0x03;
    const layer = (second >> 1) & 0x03;
    const bitrate = (third >> 4) & 0x0f;
    const sampleRate = (third >> 2) & 0x03;
    if (first === 0xff && (second & 0xe0) === 0xe0 && version !== 0x01 && layer !== 0
      && bitrate !== 0 && bitrate !== 0x0f && sampleRate !== 0x03) return true;
  }
  return false;
}

function hasCompatibleMp4Ftyp(bytes: Uint8Array): boolean {
  const compatibleBrands = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash']);
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size = readUint32BE(bytes, offset);
    if (size < 8 || offset + size > bytes.byteLength) return false;
    if (bytes[offset + 4] === 0x66 && bytes[offset + 5] === 0x74 && bytes[offset + 6] === 0x79 && bytes[offset + 7] === 0x70) {
      if (size < 20 || (size - 16) % 4 !== 0) return false;
      for (let brandOffset = offset + 8; brandOffset + 4 <= offset + size; brandOffset += brandOffset === offset + 8 ? 8 : 4) {
        const brand = String.fromCharCode(...bytes.slice(brandOffset, brandOffset + 4));
        if (compatibleBrands.has(brand)) return true;
      }
      return false;
    }
    offset += size;
  }
  return false;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0;
}

function mediaResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function rangeNotSatisfiable(total: number): Response {
  return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function mediaHostError(reasonCode: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({ code: reasonCode === 'forbidden-renderer-access' ? 'forbidden-renderer-access' : 'invalid-payload',
    message: reasonCode, reasonCode, actionHint: 'use_typed_local_app_asset_media' });
}
