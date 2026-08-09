import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronFixture = vi.hoisted(() => ({
  protocolHandler: undefined as ((request: { readonly url: string; readonly headers: Headers }) => Promise<Response>) | undefined,
  beforeRequest: undefined as ((
    details: { readonly url: string; readonly webContentsId?: number; readonly resourceType?: string },
    callback: (response: { readonly cancel: boolean }) => void,
  ) => void) | undefined,
  privilegedSchemes: [] as string[],
  listeners: new Map<number, Map<string, Set<(...args: unknown[]) => void>>>(),
}));

const platform = {
  protocol: {
    registerSchemesAsPrivileged(entries: readonly { readonly scheme: string }[]) {
      electronFixture.privilegedSchemes.push(...entries.map((entry) => entry.scheme));
    },
    handle(_scheme: string, handler: typeof electronFixture.protocolHandler) {
      electronFixture.protocolHandler = handler;
    },
    unhandle() { electronFixture.protocolHandler = undefined; },
  },
  webRequest: {
    onBeforeRequest(
      _filter: unknown,
      listener: typeof electronFixture.beforeRequest | null,
    ) { electronFixture.beforeRequest = listener ?? undefined; },
  },
  webContents: {
    fromId(rendererId: number) {
      let listeners = electronFixture.listeners.get(rendererId);
      if (!listeners) {
        listeners = new Map();
        electronFixture.listeners.set(rendererId, listeners);
      }
      const add = (event: string, listener: (...args: unknown[]) => void) => {
        let entries = listeners!.get(event);
        if (!entries) { entries = new Set(); listeners!.set(event, entries); }
        entries.add(listener);
      };
      return { on: add, once: add };
    },
  },
};

import {
  NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME,
  createNimiElectronLocalAppAssetMediaHost,
  registerNimiElectronAppAssetProtocolScheme,
} from '../src/main/app-asset-protocol.js';
import type { NimiElectronLocalAppHost, NimiElectronLocalAppRecord } from '../src/main/local-app-host.js';

const RELATIVE_PATH = 'media/generated.png';
const SHA256 = `sha256:${'a'.repeat(64)}`;
const PNG_BYTES = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10,
  ...Array.from({ length: 248 }, (_, index) => index & 0xff),
]);

type AssetHostFixture = {
  readonly host: NimiElectronLocalAppHost;
  readonly openCalls: NimiElectronLocalAppRecord[];
  readonly nextCalls: string[];
  deferNext(): { reject(error: Error): void };
  setDigest(value: string): void;
};

beforeEach(() => {
  electronFixture.protocolHandler = undefined;
  electronFixture.beforeRequest = undefined;
  electronFixture.privilegedSchemes.length = 0;
  electronFixture.listeners.clear();
});

describe('Electron local-app opaque asset media protocol', () => {
  it('registers an independent scheme, bounds signature reads, and re-enters typed Base read for every range', async () => {
    registerNimiElectronAppAssetProtocolScheme(platform.protocol);
    const fixture = createAssetHostFixture(PNG_BYTES);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });
    const opened = await mediaHost.open(RELATIVE_PATH, 7);

    expect(electronFixture.privilegedSchemes).toEqual([NIMI_ELECTRON_APP_ASSET_PROTOCOL_SCHEME]);
    expect(opened.url).toMatch(/^nimi-app-asset:\/\/media\/[A-Za-z0-9_-]{43}$/u);
    expect(opened.url).not.toContain(RELATIVE_PATH);
    expect(opened.url).not.toContain('nimi-shell-file');
    expect(fixture.openCalls[0]).toEqual({ relativePath: RELATIVE_PATH, offset: 0, length: 8 });

    const first = await requestMedia(opened.url, 7, 'bytes=8-23');
    expect(first.status).toBe(206);
    expect(first.headers.get('content-type')).toBe('image/png');
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.headers.get('content-range')).toBe(`bytes 8-23/${PNG_BYTES.byteLength}`);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PNG_BYTES.slice(8, 24));

    const second = await requestMedia(opened.url, 7, 'bytes=-12');
    expect(second.status).toBe(206);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(PNG_BYTES.slice(-12));
    expect(fixture.openCalls.slice(1)).toEqual([
      { relativePath: RELATIVE_PATH, offset: 8, length: 16 },
      { relativePath: RELATIVE_PATH, offset: PNG_BYTES.byteLength - 12, length: 12 },
    ]);
    mediaHost.close();
  });

  it('requires the issuing renderer admission for every request and denies navigation and direct protocol bypass', async () => {
    const fixture = createAssetHostFixture(PNG_BYTES);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });
    const opened = await mediaHost.open(RELATIVE_PATH, 7);

    expect(electronFixture.protocolHandler).toBeDefined();
    const withoutAdmissionCoupling = await electronFixture.protocolHandler!({
      url: opened.url,
      headers: new Headers({ range: 'bytes=0-7' }),
    });
    expect(withoutAdmissionCoupling.status).toBe(403);
    expect(approve(opened.url, undefined, 'media')).toBe(false);
    expect(approve(opened.url, 0, 'media')).toBe(false);
    expect(approve(opened.url, 8, 'media')).toBe(false);
    expect(approve(opened.url, 7, 'mainFrame')).toBe(false);
    expect(approve(opened.url, 7, 'subFrame')).toBe(false);
    expect(approve(opened.url, 7, 'media')).toBe(true);
    const admitted = await electronFixture.protocolHandler!({
      url: opened.url,
      headers: new Headers({ range: 'bytes=0-7' }),
    });
    expect(admitted.status).toBe(206);
    const replayedAdmission = await electronFixture.protocolHandler!({
      url: opened.url,
      headers: new Headers({ range: 'bytes=0-7' }),
    });
    expect(replayedAdmission.status).toBe(403);
    mediaHost.close();
  });

  it.each([
    ['audio/mpeg', mediaPrefix([0xff, 0xfb, 0x90, 0x64], 100)],
    ['audio/ogg', mediaPrefix([
      0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 8,
      0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
    ])],
    ['video/mp4', mediaPrefix([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
      0x6d, 0x70, 0x34, 0x32, 0x61, 0x76, 0x63, 0x31,
    ])],
    ['video/webm', mediaPrefix([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])],
  ] as const)('validates %s within a bounded 64 KiB prefix', async (mediaType, bytes) => {
    const fixture = createAssetHostFixture(bytes, mediaType);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });

    await expect(mediaHost.open(RELATIVE_PATH, 7)).resolves.toMatchObject({ url: expect.stringMatching(/^nimi-app-asset:/u) });
    expect(fixture.openCalls).toEqual([{ relativePath: RELATIVE_PATH, offset: 0, length: 64 * 1024 }]);
    mediaHost.close();
  });

  it.each([
    ['audio/mpeg', mediaPrefix([0xff, 0xe0, 0, 0])],
    ['audio/ogg', mediaPrefix([0x4f, 0x67, 0x67, 0x53])],
    ['video/mp4', mediaPrefix([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x7a, 0x7a, 0x7a, 0x7a, 0, 0, 0, 0,
      0x7a, 0x7a, 0x7a, 0x7a, 0x7a, 0x7a, 0x7a, 0x7a,
    ])],
    ['video/webm', mediaPrefix([0x1a, 0x45, 0xdf, 0xa3])],
  ] as const)('rejects weak %s magic without the required bounded container or frame signature', async (mediaType, bytes) => {
    const fixture = createAssetHostFixture(bytes, mediaType);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });

    await expect(mediaHost.open(RELATIVE_PATH, 7)).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    expect(fixture.openCalls).toEqual([{ relativePath: RELATIVE_PATH, offset: 0, length: 64 * 1024 }]);
    mediaHost.close();
  });

  it('keeps the opaque handle valid when seek cancels an in-flight range read', async () => {
    const fixture = createAssetHostFixture(PNG_BYTES);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });
    const opened = await mediaHost.open(RELATIVE_PATH, 7);
    const deferred = fixture.deferNext();
    const first = await requestMedia(opened.url, 7, 'bytes=0-127');
    const reader = first.body!.getReader();
    const reading = reader.read();
    await vi.waitFor(() => expect(fixture.nextCalls).toHaveLength(2));
    const cancelling = reader.cancel();
    deferred.reject(new Error('range stream was closed by seek'));
    await Promise.allSettled([reading, cancelling]);

    expect(approve(opened.url, 7)).toBe(true);
    const second = await electronFixture.protocolHandler!({
      url: opened.url,
      headers: new Headers({ range: 'bytes=8-15' }),
    });
    expect(second.status).toBe(206);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(PNG_BYTES.slice(8, 16));
    mediaHost.close();
  });

  it('rejects an unsafe signature without reading the complete body', async () => {
    const unsafe = PNG_BYTES.slice();
    unsafe[0] = 0;
    const fixture = createAssetHostFixture(unsafe);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });

    await expect(mediaHost.open(RELATIVE_PATH, 7)).rejects.toMatchObject({ reasonCode: 'invalid-payload' });
    expect(fixture.openCalls).toEqual([{ relativePath: RELATIVE_PATH, offset: 0, length: 8 }]);
    expect(fixture.nextCalls).toHaveLength(1);
    mediaHost.close();
  });

  it('revokes before body chunks when pinned metadata changes', async () => {
    const fixture = createAssetHostFixture(PNG_BYTES);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform });
    const opened = await mediaHost.open(RELATIVE_PATH, 7);
    const prefixNextCount = fixture.nextCalls.length;
    fixture.setDigest(`sha256:${'b'.repeat(64)}`);

    const response = await requestMedia(opened.url, 7, 'bytes=0-15');
    expect(response.status).toBe(409);
    expect(fixture.nextCalls).toHaveLength(prefixNextCount);
    expect(approve(opened.url, 7)).toBe(false);
    mediaHost.close();
  });

  it('scopes handle control to its renderer and invalidates on revoke, path mutation, navigation, close, and expiry', async () => {
    let clock = 1_000;
    const fixture = createAssetHostFixture(PNG_BYTES);
    const mediaHost = createNimiElectronLocalAppAssetMediaHost({ localAppHost: fixture.host, platform, ttlMs: 1_000, now: () => clock });

    const rendererScoped = await mediaHost.open(RELATIVE_PATH, 7);
    expect(approve(rendererScoped.url, 8)).toBe(false);
    expect(mediaHost.revoke(rendererScoped.handle, 8)).toBe(false);
    expect(mediaHost.revoke(rendererScoped.handle, 7)).toBe(true);
    expect(approve(rendererScoped.url, 7)).toBe(false);

    const mutated = await mediaHost.open(RELATIVE_PATH, 7);
    mediaHost.invalidatePath(RELATIVE_PATH);
    expect(approve(mutated.url, 7)).toBe(false);

    const navigated = await mediaHost.open(RELATIVE_PATH, 7);
    emitRendererEvent(7, 'did-start-navigation', {}, 'nimi-app-asset://media/subresource', false, false);
    expect(approve(navigated.url, 7)).toBe(true);
    emitRendererEvent(7, 'did-start-navigation', {}, 'http://127.0.0.1:1468/next', false, true);
    expect(approve(navigated.url, 7)).toBe(false);

    const closed = await mediaHost.open(RELATIVE_PATH, 7);
    emitRendererEvent(7, 'destroyed');
    expect(approve(closed.url, 7)).toBe(false);

    const expired = await mediaHost.open(RELATIVE_PATH, 9);
    clock += 1_001;
    expect(approve(expired.url, 9)).toBe(false);
    mediaHost.close();

    expect(() => createNimiElectronLocalAppAssetMediaHost({
      localAppHost: fixture.host,
      platform,
      ttlMs: 10 * 60 * 1000 + 1,
    })).toThrow('App asset handle TTL is invalid');
  });
});

function createAssetHostFixture(bytes: Uint8Array, mediaType = 'image/png'): AssetHostFixture {
  const openCalls: NimiElectronLocalAppRecord[] = [];
  const nextCalls: string[] = [];
  const streams = new Map<string, Uint8Array>();
  let digest = SHA256;
  let sequence = 0;
  let deferredNext: Promise<NimiElectronLocalAppRecord> | undefined;
  const metadata = () => ({
    relativePath: RELATIVE_PATH,
    mediaType,
    sizeBytes: bytes.byteLength,
    sha256: digest,
  });
  const host = {
    async assetStat() { return metadata(); },
    async assetReadOpen(input: NimiElectronLocalAppRecord) {
      openCalls.push({ ...input });
      const offset = Number(input.offset ?? 0);
      const length = Number(input.length ?? bytes.byteLength - offset);
      const streamId = `stream-${++sequence}`;
      streams.set(streamId, bytes.slice(offset, offset + length));
      return {
        streamId,
        asset: metadata(),
        range: { offset, length, totalSize: bytes.byteLength },
      };
    },
    async assetReadNext(input: NimiElectronLocalAppRecord) {
      const streamId = String(input.streamId);
      nextCalls.push(streamId);
      if (deferredNext) {
        const pending = deferredNext;
        deferredNext = undefined;
        return pending;
      }
      const bodyChunk = streams.get(streamId);
      if (!bodyChunk) return { completed: true as const };
      streams.delete(streamId);
      return { completed: false as const, bodyChunk };
    },
    async assetReadClose(input: NimiElectronLocalAppRecord) {
      streams.delete(String(input.streamId));
      return { closed: true };
    },
  } as unknown as NimiElectronLocalAppHost;
  return {
    host,
    openCalls,
    nextCalls,
    deferNext() {
      let reject!: (error: Error) => void;
      deferredNext = new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
      return { reject };
    },
    setDigest(value) { digest = value; },
  };
}

function mediaPrefix(prefix: readonly number[], offset = 0): Uint8Array {
  const bytes = new Uint8Array(70 * 1024);
  bytes.set(prefix, offset);
  return bytes;
}

function approve(
  url: string,
  rendererId: number | undefined,
  resourceType = 'media',
): boolean {
  if (!electronFixture.beforeRequest) throw new Error('before-request filter is not registered');
  let admitted = false;
  electronFixture.beforeRequest({ url, webContentsId: rendererId, resourceType }, ({ cancel }) => { admitted = !cancel; });
  return admitted;
}

async function requestMedia(url: string, rendererId: number, range?: string): Promise<Response> {
  if (!approve(url, rendererId)) throw new Error('media request was rejected before protocol dispatch');
  if (!electronFixture.protocolHandler) throw new Error('media protocol handler is not registered');
  return electronFixture.protocolHandler({ url, headers: new Headers(range ? { range } : undefined) });
}

function emitRendererEvent(rendererId: number, event: string, ...args: unknown[]): void {
  for (const listener of electronFixture.listeners.get(rendererId)?.get(event) ?? []) listener(...args);
}
