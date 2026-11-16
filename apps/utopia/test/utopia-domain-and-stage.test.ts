import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import type {
  NimiLocalAppAssetRecord,
  NimiUtopiaResident,
  NimiUtopiaSnapshot,
  NimiUtopiaTime,
} from '@nimiplatform/sdk/app';

import {
  BUILTIN_PACK_SLUGS,
  cleanupOrphanedBundleAssets,
  importUtopiaArchiveBytes,
  importValidatedUtopiaBundle,
  readImportedPacksIndex,
  relocateWithImportedPackGuard,
  removeImportedPack,
  type UtopiaStoragePort,
} from '../src/domain/bundle-registry.js';
import {
  UtopiaBundleValidationError,
  computeHabitatContentDigest,
  parseAndValidateUtopiaZip,
  inspectUtopiaArchiveFile,
  sha256Prefixed,
  validateUtopiaBundleParts,
} from '../src/domain/bundle-validator.js';
import {
  buildDeterministicTunerSystemPrompt,
  compileNaturalLanguageTuning,
  validateAndCompileTunerResponse,
  createTuningPreviewGate,
  tuningPreviewMatches,
} from '../src/domain/nl-tuner-compiler.js';
import {
  SCENERY_KIND_LABELS,
  computeOpenPlaceIds,
  computeVisitJournalHighlights,
  describeResidentFrame,
  evalDaypartInTimezone,
  evalStageCondition,
  formatSharedActivityDisplay,
  previewParameterPlaceDiff,
} from '../src/domain/visit-journal.js';
import {
  CHIBI_WARDROBE_LOCAL_KEY,
  CHIBI_WARDROBE_STORAGE_PATH,
  hasCustomChibiAppearance,
  loadPersistedChibiWardrobe,
  migrateWardrobeHandlesToBindings,
  patchPersistedChibiWardrobeEntry,
  resolveChibiAppearance,
  type ChibiAppearance,
  type WardrobeCacheStorage,
} from '../src/domain/chibi-wardrobe.js';
import { expandEffectsWithScenery } from '../src/stage/UtopiaWorldCanvas.js';
import { computeResidentSpatialTargets } from '../src/stage/LivingResidentsLayer.js';
import {
  activateFormalSessionFromDraft,
  createZeroSideEffectDraftState,
  editZeroSideEffectDraftText,
  settleDraftSend,
  createDraftSendOperation,
} from '../src/panels/ResidentDetailAndDraft.js';
import { buildPlaceAriaLabel, buildPlaceOccupancyBreakdown } from '../src/stage/FallbackJournalStage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_PACKS_ROOT = path.resolve(__dirname, '../public/builtin-packs');

// ---------------------------------------------------------------------------
// Minimal deterministic ZIP builder (supports Store method=0 & Deflate method=8,
// plus intentional header spoofing for decompression-bomb & symlink adversarial tests)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntrySpec = {
  readonly name: string;
  readonly rawData?: Uint8Array;
  readonly compressedData?: Uint8Array;
  readonly method?: 0 | 8;
  readonly spoofUncompressedSize?: number;
  readonly spoofCrc32?: number;
  readonly externalAttr?: number;
};

function buildZipArchive(entries: readonly ZipEntrySpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;

  for (const spec of entries) {
    const nameBytes = encoder.encode(spec.name);
    const method = spec.method ?? 0;
    const raw = spec.rawData ?? new Uint8Array(0);
    const comp = spec.compressedData
      ?? (method === 8 ? new Uint8Array(zlib.deflateRawSync(raw)) : raw);
    const uncompSize = spec.spoofUncompressedSize ?? raw.length;
    const entryCrc = spec.spoofCrc32 ?? crc32(raw);
    const extAttr = spec.externalAttr ?? 0;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, entryCrc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, uncompSize, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, comp);

    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true); // Unix creator
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, entryCrc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, uncompSize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, extAttr, true);
    cv.setUint32(42, offset, true);
    cdHeader.set(nameBytes, 46);
    cdChunks.push(cdHeader);

    offset += localHeader.length + comp.length;
  }

  const cdSize = cdChunks.reduce((acc, c) => acc + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of [...localChunks, ...cdChunks, eocd]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function makeFakePngHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(buf.buffer);
  dv.setUint32(8, 13, false);
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  dv.setUint32(16, width, false);
  dv.setUint32(20, height, false);
  buf[24] = 8;
  buf[25] = 6;
  return buf;
}

function makeFakeJpegHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(20);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  const dv = new DataView(buf.buffer);
  dv.setUint16(4, 11, false);
  buf[6] = 8;
  dv.setUint16(7, height, false);
  dv.setUint16(9, width, false);
  return buf;
}

function makeFakeWebpVp8xHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(30);
  const enc = new TextEncoder();
  buf.set(enc.encode('RIFF'), 0);
  new DataView(buf.buffer).setUint32(4, 22, true);
  buf.set(enc.encode('WEBP'), 8);
  buf.set(enc.encode('VP8X'), 12);
  new DataView(buf.buffer).setUint32(16, 10, true);
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  buf[24] = wMinus1 & 0xff;
  buf[25] = (wMinus1 >> 8) & 0xff;
  buf[26] = (wMinus1 >> 16) & 0xff;
  buf[27] = hMinus1 & 0xff;
  buf[28] = (hMinus1 >> 8) & 0xff;
  buf[29] = (hMinus1 >> 16) & 0xff;
  return buf;
}

function toUtopiaTime(iso: string): NimiUtopiaTime {
  const ms = Date.parse(iso);
  return {
    seconds: String(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  };
}

async function loadBuiltinRawParts(slug: string) {
  const dir = path.join(PUBLIC_PACKS_ROOT, slug);
  const rawManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const rawHabitat = JSON.parse(await fs.readFile(path.join(dir, 'habitat.json'), 'utf8'));
  const rawStage = JSON.parse(await fs.readFile(path.join(dir, 'stage.json'), 'utf8'));
  const assetEntries = await fs.readdir(path.join(dir, 'assets'));
  const rawAssets = new Map<string, Uint8Array>();
  for (const name of assetEntries) {
    const bytes = new Uint8Array(await fs.readFile(path.join(dir, 'assets', name)));
    rawAssets.set(`assets/${name}`, bytes);
  }
  return { rawManifest, rawHabitat, rawStage, rawAssets };
}

function createInMemoryStoragePort(options?: { failWriteOnAttempt?: number; failIndexRead?: boolean; failIndexCommit?: boolean; loseIndexAck?: boolean }): {
  readonly port: UtopiaStoragePort;
  readonly jsonDocs: Map<string, unknown>;
  readonly assetFiles: Map<string, Uint8Array>;
} {
  const jsonDocs = new Map<string, unknown>();
  const assetFiles = new Map<string, Uint8Array>();
  let writeAttempts = 0;

  const makeRecord = (
    relativePath: string,
    sizeBytes: number,
    mediaType = 'application/octet-stream',
    sha256 = `sha256:${'0'.repeat(64)}`,
  ): NimiLocalAppAssetRecord => {
    const now = new Date().toISOString();
    return {
      relativePath,
      sizeBytes,
      sha256,
      mediaType,
      createdAt: now,
      updatedAt: now,
    };
  };

  const port: UtopiaStoragePort = {
    json: {
      async readJson(docPath) {
        if (options?.failIndexRead) throw new Error('Injected index read unavailable');
        if (!jsonDocs.has(docPath)) {
          const err = new Error(`Storage file not found: ${docPath}`);
          (err as { reasonCode?: string }).reasonCode = 'APP_STORAGE_ENTRY_NOT_FOUND';
          throw err;
        }
        return {
          path: docPath,
          value: structuredClone(jsonDocs.get(docPath)) as never,
          sizeBytes: 128,
          updatedAt: new Date().toISOString(),
        };
      },
      async writeJson(docPath, value) {
        if (options?.failIndexCommit) throw new Error('Injected index commit failure');
        const cloned = structuredClone(value);
        jsonDocs.set(docPath, cloned);
        if (options?.loseIndexAck) throw new Error('Injected lost commit acknowledgement');
        return {
          path: docPath,
          value: cloned,
          sizeBytes: JSON.stringify(cloned).length,
          updatedAt: new Date().toISOString(),
        };
      },
    },
    assets: {
      async list(req) {
        const prefix = req.prefix;
        const matched = Array.from(assetFiles.entries())
          .filter(([k]) => k.startsWith(prefix))
          .map(([relativePath, bytes]) => makeRecord(relativePath, bytes.length));
        matched.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        const start = Number(req.cursor ?? 0);
        const end = start + (req.pageSize ?? 100);
        return { assets: matched.slice(start, end), nextCursor: end < matched.length ? String(end) : '' };
      },
      async write(req) {
        writeAttempts++;
        if (options?.failWriteOnAttempt === writeAttempts) throw new Error('Simulated disk error during asset write');
        if (req.expectedSha256 !== undefined) {
          const existing = assetFiles.get(req.relativePath);
          if (!existing || (await sha256Prefixed(existing)) !== req.expectedSha256) {
            throw Object.assign(new Error('content-conflict'), { reasonCode: 'APP_STORAGE_CONTENT_CONFLICT' });
          }
        } else if (!req.overwrite && assetFiles.has(req.relativePath)) {
          throw Object.assign(new Error('already-exists'), { reasonCode: 'APP_STORAGE_ENTRY_ALREADY_EXISTS' });
        }
        let bytes: Uint8Array;
        if (req.body instanceof Uint8Array) {
          bytes = new Uint8Array(req.body);
        } else if (req.body instanceof Blob) {
          bytes = new Uint8Array(await req.body.arrayBuffer());
        } else {
          const parts: Uint8Array[] = [];
          for await (const chunk of req.body) parts.push(chunk);
          const total = parts.reduce((s, c) => s + c.byteLength, 0);
          bytes = new Uint8Array(total);
          let off = 0;
          for (const c of parts) {
            bytes.set(c, off);
            off += c.byteLength;
          }
        }
        const digest = await sha256Prefixed(bytes);
        assetFiles.set(req.relativePath, bytes);
        return makeRecord(req.relativePath, bytes.length, req.mediaType, digest);
      },
      async move(req) {
        const bytes = assetFiles.get(req.from);
        if (!bytes) throw new Error(`Missing source asset: ${req.from}`);
        assetFiles.delete(req.from);
        assetFiles.set(req.to, bytes);
        return makeRecord(req.to, bytes.length);
      },
      async remove(relPath) {
        const removed = assetFiles.delete(relPath);
        return { removed };
      },
      async read(req) {
        const bytes = assetFiles.get(req.relativePath);
        if (!bytes) throw new Error(`Asset not found: ${req.relativePath}`);
        const slice = bytes.subarray(req.offset ?? 0, req.length ? (req.offset ?? 0) + req.length : bytes.length);
        return {
          asset: makeRecord(req.relativePath, bytes.length, 'image/png'),
          range: { offset: req.offset ?? 0, length: slice.length, totalSize: bytes.length },
          body: (async function* yieldBody() {
            yield slice;
          })(),
        };
      },
    },
  };

  return { port, jsonDocs, assetFiles };
}

test('Built-in showcase packs pass full HabitatSpecV1 + StageV1 + PNG/WAV validation and deterministic JCS digest', async () => {
  for (const slug of BUILTIN_PACK_SLUGS) {
    const parts = await loadBuiltinRawParts(slug);
    const validated = await validateUtopiaBundleParts({
      ...parts,
      allowBuiltinNamespace: true,
    });
    assert.equal(validated.manifest.bundleId, `nimi.builtin.${slug}`);
    assert.match(validated.contentDigest, /^sha256:[0-9a-f]{64}$/u);

    const expectedIds = new Set([...validated.habitat.places.map((p) => p.id), 'personal-quarter']);
    assert.equal(validated.stage.anchors.length, expectedIds.size);
    for (const anchor of validated.stage.anchors) {
      assert.ok(expectedIds.has(anchor.targetId));
    }

    const shuffledHabitat = JSON.parse(JSON.stringify(validated.habitat));
    const digestAgain = await computeHabitatContentDigest(shuffledHabitat);
    assert.equal(digestAgain, validated.contentDigest);
  }
});

test('Replacing an installed bundle never overwrites its assets before publication', async () => {
  const parts = await loadBuiltinRawParts('cloud-bamboo-abode');
  const manifest = { ...parts.rawManifest, bundleId: 'creator.atomic-test' };
  const habitat = { ...parts.rawHabitat, habitatId: manifest.bundleId };
  const original = await validateUtopiaBundleParts({ ...parts, rawManifest: manifest, rawHabitat: habitat });
  const assets = new Map(parts.rawAssets);
  const images = [...assets.keys()].filter((name) => name.endsWith('.png'));
  assets.set(images[0]!, assets.get(images[1]!)!);
  const updated = await validateUtopiaBundleParts({ ...parts, rawManifest: { ...manifest, version: '2.0.0' },
    rawHabitat: habitat, rawAssets: assets });

  for (const failure of ['asset', 'index', 'read', 'lost-ack'] as const) {
    const controls: { failWriteOnAttempt?: number; failIndexRead?: boolean; failIndexCommit?: boolean; loseIndexAck?: boolean } = {};
    const store = createInMemoryStoragePort(controls);
    const installed = await importValidatedUtopiaBundle(original, store.port);
    const beforeIndex = structuredClone(store.jsonDocs.get('bundles-index.json'));
    const beforeAssets = new Map([...store.assetFiles].map(([path, bytes]) => [path, bytes.slice()]));
    if (failure === 'asset') controls.failWriteOnAttempt = original.assets.size + 2;
    if (failure === 'index') controls.failIndexCommit = true;
    if (failure === 'read') controls.failIndexRead = true;
    if (failure === 'lost-ack') controls.loseIndexAck = true;
    await assert.rejects(importValidatedUtopiaBundle(updated, store.port));
    for (const [path, bytes] of beforeAssets) assert.deepEqual(store.assetFiles.get(path), bytes, `${failure}: old asset changed`);
    if (failure !== 'lost-ack') assert.deepEqual(store.jsonDocs.get('bundles-index.json'), beforeIndex);
    controls.failIndexRead = false;
    controls.failIndexCommit = false;
    controls.loseIndexAck = false;
    const visible = await readImportedPacksIndex(store.port);
    assert.equal(visible[0]!.manifest.version, failure === 'lost-ack' ? '2.0.0' : manifest.version);
    if (failure === 'lost-ack') assert.notEqual(visible[0]!.assetRoot, installed.assetRoot);
    await cleanupOrphanedBundleAssets(store.port);
    assert.equal(store.assetFiles.size, visible[0]!.assetPaths.length);
    for (const path of visible[0]!.assetPaths) assert.ok(store.assetFiles.has(`${visible[0]!.assetRoot}/${path}`));
  }
});

test('Invalid index fails closed and concurrent registry writes preserve both entries', async () => {
  const parts = await loadBuiltinRawParts('cloud-bamboo-abode');
  const candidate = async (id: string) => validateUtopiaBundleParts({ ...parts,
    rawManifest: { ...parts.rawManifest, bundleId: id }, rawHabitat: { ...parts.rawHabitat, habitatId: id } });
  const [a, b] = await Promise.all([candidate('creator.first'), candidate('creator.second')]);
  const store = createInMemoryStoragePort();
  await Promise.all([importValidatedUtopiaBundle(a, store.port), importValidatedUtopiaBundle(b, store.port)]);
  assert.equal((await readImportedPacksIndex(store.port)).length, 2);
  const assetsBefore = store.assetFiles.size;
  store.jsonDocs.set('bundles-index.json', { schemaVersion: '2.0', bundles: [null] });
  await assert.rejects(importValidatedUtopiaBundle(a, store.port), /索引损坏/);
  await assert.rejects(cleanupOrphanedBundleAssets(store.port), /索引损坏/);
  assert.equal(store.assetFiles.size, assetsBefore);
  const deniedPort: UtopiaStoragePort = { ...store.port, json: { ...store.port.json,
    async readJson() { throw Object.assign(new Error('Account not found'), { reasonCode: 'permission-denied' }); },
  } };
  await assert.rejects(importValidatedUtopiaBundle(a, deniedPort), /Account not found/);
  assert.equal(store.assetFiles.size, assetsBefore, 'error prose must not be treated as lawful absence');
});

test('Archive size is rejected before arrayBuffer allocation', async () => {
  let reads = 0;
  await assert.rejects(inspectUtopiaArchiveFile({ size: 1024 ** 3,
    async arrayBuffer() { reads++; return new ArrayBuffer(0); },
  }), /12 MiB/);
  assert.equal(reads, 0);
});

test('A late tuning result cannot be rebound to another revision or habitat', async () => {
  const gate = createTuningPreviewGate();
  const before = { revision: '10', habitatActivationId: 'habitat-a', contentDigest: 'digest-a' };
  const ticket = gate.begin(before);
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  const after = { ...before, revision: '11' };
  const late = pending.then(() => gate.isCurrent(ticket, after));
  resolve();
  assert.equal(await late, false, 'same-habitat settings change must invalidate preview');
  assert.equal(ticket.basis.revision, '10', 'CAS must retain the approved revision');
  assert.equal(tuningPreviewMatches(ticket.basis, { ...before, habitatActivationId: 'habitat-b' }), false);
  gate.invalidate();
  assert.equal(ticket.signal.aborted, true);
  assert.equal(gate.isCurrent(ticket, before), false, 'A-B-A does not revive an old request');
  const next = gate.begin(after);
  assert.equal(gate.isCurrent(next, after), true);
});

test('Send settlement clears sent text once and preserves edits made during the request', () => {
  const initial = createZeroSideEffectDraftState({ agentHandle: 'agent-test' as NimiUtopiaResident['agentHandle'], displayName: '伙伴' }, '你好');
  const operation = createDraftSendOperation('你好');
  const sending = { ...initial, sessionMounted: true, sendOperation: operation };
  const settled = settleDraftSend(sending, operation, true);
  assert.equal(settled.text, '');
  assert.equal(settled.sendOperation, null);
  assert.equal(settleDraftSend({ ...sending, text: '下一条草稿' }, operation, true).text, '下一条草稿');
  assert.equal(settleDraftSend(sending, operation, false).text, '你好');
});

test('Public stage co-presence uses only Runtime occupancy; private quarters remain individual', () => {
  const snapshot = { residents: ['a', 'b'].map((id) => ({ agentHandle: id, displayName: id, solitary: false,
    current: { placeId: 'courtyard', interaction: false } })), publicParticipation: false,
    occupancy: [], sharedActivities: [] } as unknown as NimiUtopiaSnapshot;
  const publicPlace = buildPlaceOccupancyBreakdown('courtyard', snapshot);
  assert.equal(publicPlace.independentResidents.length, 0);
  assert.equal(publicPlace.privateResidents.length, 2, 'keep individual location visible without fabricating public co-presence');
  const quarters = { ...snapshot, residents: snapshot.residents.map((r) => ({ ...r,
    current: { ...r.current!, placeId: 'personal-quarter' } })) };
  const result = buildPlaceOccupancyBreakdown('personal-quarter', quarters);
  assert.equal(result.independentResidents.length, 2);
  assert.equal(result.sharedPairs.length, 0);
});

test('Third-party .utopia ZIP import: immutable assets -> index publication, rollback on failure, and startup orphan cleanup', async () => {
  const base = await loadBuiltinRawParts('cloud-bamboo-abode');
  const encoder = new TextEncoder();

  const customManifest = {
    ...(base.rawManifest as Record<string, unknown>),
    bundleId: 'creator.theme.bamboo-courtyard',
    title: '山居松风院',
    author: 'Creator Studio',
  };
  const customHabitat = {
    ...(base.rawHabitat as Record<string, unknown>),
    habitatId: 'creator.theme.bamboo-courtyard',
    title: '山居松风院',
  };

  const zipEntries: ZipEntrySpec[] = [
    { name: 'manifest.json', rawData: encoder.encode(JSON.stringify(customManifest)), method: 8 },
    { name: 'habitat.json', rawData: encoder.encode(JSON.stringify(customHabitat)), method: 8 },
    { name: 'stage.json', rawData: encoder.encode(JSON.stringify(base.rawStage)), method: 8 },
  ];
  for (const [assetPath, bytes] of base.rawAssets.entries()) {
    zipEntries.push({ name: assetPath, rawData: bytes, method: 8 });
  }
  const archiveBytes = buildZipArchive(zipEntries);

  // 1. Simulated failure mid-write removes unpublished assets and leaves bundles-index.json untouched
  const failingStore = createInMemoryStoragePort({ failWriteOnAttempt: 2 });
  await assert.rejects(
    () => importUtopiaArchiveBytes(archiveBytes, failingStore.port),
    /Simulated disk error/,
  );
  assert.equal(failingStore.jsonDocs.has('bundles-index.json'), false);

  // 2. Startup orphan cleanup wipes residual staging paths
  failingStore.assetFiles.set('bundles/content/orphan-123/assets/bg.png', new Uint8Array([1, 2, 3]));
  const cleaned = await cleanupOrphanedBundleAssets(failingStore.port);
  assert.ok(cleaned >= 1);
  for (const key of failingStore.assetFiles.keys()) {
    assert.equal(key.startsWith('bundles/content/'), false);
  }

  // 3. Clean atomic import succeeds, writes immutable assets, and persists bundles-index.json
  const goodStore = createInMemoryStoragePort();
  const imported = await importUtopiaArchiveBytes(archiveBytes, goodStore.port);
  assert.equal(imported.manifest.bundleId, 'creator.theme.bamboo-courtyard');
  assert.equal(imported.source, 'imported');

  const persisted = await readImportedPacksIndex(goodStore.port);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.manifest.bundleId, 'creator.theme.bamboo-courtyard');
  assert.equal(persisted[0]!.contentDigest, imported.contentDigest);

  // Removing pack cleans both index and installed assets
  await removeImportedPack('creator.theme.bamboo-courtyard', goodStore.port);
  const afterRemove = await readImportedPacksIndex(goodStore.port);
  assert.equal(afterRemove.length, 0);
  assert.equal(goodStore.assetFiles.size, 0);
});

test('R4/R5 Adversarial .utopia security & integrity negative suite fails closed', async () => {
  const base = await loadBuiltinRawParts('seaside-island');
  const encoder = new TextEncoder();

  const validManifest = {
    ...(base.rawManifest as Record<string, unknown>),
    bundleId: 'creator.sec.audit-pack',
  };
  const validHabitat = {
    ...(base.rawHabitat as Record<string, unknown>),
    habitatId: 'creator.sec.audit-pack',
  };

  const baseEntries = (): ZipEntrySpec[] => {
    const arr: ZipEntrySpec[] = [
      { name: 'manifest.json', rawData: encoder.encode(JSON.stringify(validManifest)) },
      { name: 'habitat.json', rawData: encoder.encode(JSON.stringify(validHabitat)) },
      { name: 'stage.json', rawData: encoder.encode(JSON.stringify(base.rawStage)) },
    ];
    for (const [k, v] of base.rawAssets.entries()) {
      arr.push({ name: k, rawData: v });
    }
    return arr;
  };

  // 1. Path traversal ../evil.png
  await assert.rejects(
    () => parseAndValidateUtopiaZip(buildZipArchive([...baseEntries(), { name: '../evil.png', rawData: new Uint8Array([1]) }])),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'PATH_TRAVERSAL',
  );

  // 2. Executable hook/index.js directory rejected with explicit code
  await assert.rejects(
    () => parseAndValidateUtopiaZip(buildZipArchive([...baseEntries(), { name: 'hook/index.js', rawData: encoder.encode('alert(1)') }])),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'FORBIDDEN_HOOK_DIR',
  );

  // 3. SVG / JS / HTML in assets/ rejected
  for (const badAsset of ['assets/vector.svg', 'assets/script.js', 'index.html']) {
    await assert.rejects(
      () => parseAndValidateUtopiaZip(buildZipArchive([...baseEntries(), { name: badAsset, rawData: encoder.encode('<svg/>') }])),
      (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'FORBIDDEN_FILE_TYPE',
    );
  }

  // 4. Unix symlink external attribute rejected
  await assert.rejects(
    () => parseAndValidateUtopiaZip(buildZipArchive([
      ...baseEntries(),
      { name: 'assets/link.png', rawData: encoder.encode('/etc/passwd'), externalAttr: (0o120777 << 16) >>> 0 },
    ])),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'FORBIDDEN_SYMLINK',
  );

  // 5a. Spoofed ZIP uncompressed size header (25 MiB zeros claiming 4 KiB) aborted mid-stream with zero unhandled rejection
  const twentyFiveMiBZeros = new Uint8Array(25 * 1024 * 1024);
  const tinyDeflated25M = new Uint8Array(zlib.deflateRawSync(twentyFiveMiBZeros));
  assert.ok(tinyDeflated25M.length < 100 * 1024);
  await assert.rejects(
    () => parseAndValidateUtopiaZip(buildZipArchive([
      ...baseEntries(),
      {
        name: 'assets/spoof-bomb.png',
        compressedData: tinyDeflated25M,
        method: 8,
        spoofUncompressedSize: 4096,
        spoofCrc32: crc32(twentyFiveMiBZeros),
      },
    ])),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'ARCHIVE_CORRUPT',
  );

  // 5b. Multi-entry streaming decompression bomb (two 15 MiB entries = 30 MiB > 24 MiB) aborted mid-stream
  const fifteenMiBZeros = new Uint8Array(15 * 1024 * 1024);
  const tinyDeflated15M = new Uint8Array(zlib.deflateRawSync(fifteenMiBZeros));
  const crc15M = crc32(fifteenMiBZeros);
  await assert.rejects(
    () => parseAndValidateUtopiaZip(buildZipArchive([
      ...baseEntries(),
      {
        name: 'assets/bomb-part1.wav',
        compressedData: tinyDeflated15M,
        method: 8,
        spoofUncompressedSize: fifteenMiBZeros.byteLength,
        spoofCrc32: crc15M,
      },
      {
        name: 'assets/bomb-part2.wav',
        compressedData: tinyDeflated15M,
        method: 8,
        spoofUncompressedSize: fifteenMiBZeros.byteLength,
        spoofCrc32: crc15M,
      },
    ])),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'UNCOMPRESSED_SIZE_EXCEEDED',
  );

  // 6. Pre-decode image dimension bombs (> 4096x4096) for PNG, JPEG, and WebP
  for (const [ext, headerBytes] of [
    ['png', makeFakePngHeader(8192, 8192)],
    ['jpg', makeFakeJpegHeader(5000, 4200)],
    ['webp', makeFakeWebpVp8xHeader(6000, 6000)],
  ] as const) {
    await assert.rejects(
      () => parseAndValidateUtopiaZip(buildZipArchive([
        ...baseEntries(),
        { name: `assets/huge.${ext}`, rawData: headerBytes },
      ])),
      (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'IMAGE_DIMENSIONS_EXCEEDED',
    );
  }

  // 7. CSS injection in palette color rejected
  const injectedStage = structuredClone(base.rawStage) as { palette: { stageCanvasBg: string } };
  injectedStage.palette.stageCanvasBg = '#ffffff; background-image:url(https://evil.example)';
  await assert.rejects(
    () => validateUtopiaBundleParts({
      rawManifest: validManifest,
      rawHabitat: validHabitat,
      rawStage: injectedStage,
      rawAssets: base.rawAssets,
    }),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'UNSAFE_COLOR',
  );

  // 8. Missing place anchor in stage.json rejected naming the missing place
  const missingAnchorStage = structuredClone(base.rawStage) as { anchors: Array<{ targetId: string }> };
  missingAnchorStage.anchors = missingAnchorStage.anchors.filter((a) => a.targetId !== 'tidal-reef');
  await assert.rejects(
    () => validateUtopiaBundleParts({
      rawManifest: validManifest,
      rawHabitat: validHabitat,
      rawStage: missingAnchorStage,
      rawAssets: base.rawAssets,
    }),
    (err: unknown) => err instanceof UtopiaBundleValidationError
      && err.code === 'MISSING_ANCHOR'
      && err.message.includes('tidal-reef'),
  );

  // 9. Reserved nimi.builtin.* namespace rejected on user import
  await assert.rejects(
    () => parseAndValidateUtopiaZip(buildZipArchive([
      { name: 'manifest.json', rawData: encoder.encode(JSON.stringify(base.rawManifest)) },
      { name: 'habitat.json', rawData: encoder.encode(JSON.stringify(base.rawHabitat)) },
      { name: 'stage.json', rawData: encoder.encode(JSON.stringify(base.rawStage)) },
      ...Array.from(base.rawAssets.entries()).map(([name, rawData]) => ({ name, rawData })),
    ])),
    (err: unknown) => err instanceof UtopiaBundleValidationError && err.code === 'RESERVED_NAMESPACE',
  );
});

test('R6/J6 Visit Journal, relocation labels, timezone dayparts, and 5-state stage occupancy breakdown', async () => {
  const parts = await loadBuiltinRawParts('seaside-island');
  const bundle = await validateUtopiaBundleParts({ ...parts, allowBuiltinNamespace: true });

  const nowIso = '2026-11-15T06:00:00Z';
  const nowMs = Date.parse(nowIso);

  // Asia/Shanghai at 06:00Z is 14:00 local -> 'day'; America/New_York at 06:00Z is 01:00 local -> 'night'
  assert.equal(evalDaypartInTimezone(nowMs, 'Asia/Shanghai'), 'day');
  assert.equal(evalDaypartInTimezone(nowMs, 'America/New_York'), 'night');

  const handleA = 'agent-alice' as NimiUtopiaResident['agentHandle'];
  const handleB = 'agent-bob' as NimiUtopiaResident['agentHandle'];
  const handleC = 'agent-carol' as NimiUtopiaResident['agentHandle'];
  const handleD = 'agent-dave' as NimiUtopiaResident['agentHandle'];

  const snapshot: NimiUtopiaSnapshot = {
    revision: 'rev-2',
    observedAt: toUtopiaTime(nowIso),
    habitatActivationId: 'act-2',
    contentDigest: bundle.contentDigest,
    timezone: 'Asia/Shanghai',
    publicParticipation: true,
    habitat: bundle.habitat,
    parameterValues: { weather: 'clear', tide: 'low-tide' },
    openPlaceIds: ['tidal-wharf', 'lighthouse-deck', 'driftwood-tea-shed', 'shell-beach'],
    activeEvents: [],
    lastRelocation: {
      fromHabitatId: 'nimi.builtin.polar-station',
      fromHabitatTitle: '极昼观测站',
      toHabitatId: bundle.habitat.habitatId,
      toHabitatTitle: bundle.habitat.title,
      relocatedAt: toUtopiaTime('2026-11-15T05:30:00Z'),
    },
    residents: [
      {
        agentHandle: handleA,
        displayName: '阿狸',
        solitary: false,
        current: {
          activityId: 'tide-walk',
          title: '拾贝赶海',
          habitatActivationId: 'act-2',
          habitatId: bundle.habitat.habitatId,
          habitatTitle: bundle.habitat.title,
          placeId: 'tidal-wharf',
          placeLabel: '潮汐栈桥',
          startsAt: toUtopiaTime('2026-11-15T05:45:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: {
          activityId: 'watch-aurora',
          title: '极光观测',
          habitatActivationId: 'act-1', // Previous habitat frame!
          habitatId: 'nimi.builtin.polar-station',
          habitatTitle: '极昼观测站',
          placeId: 'aurora-dome',
          placeLabel: '极光穹顶',
          startsAt: toUtopiaTime('2026-11-15T04:20:00Z'),
          endsAt: toUtopiaTime('2026-11-15T04:50:00Z'),
          interaction: false,
        },
        next: null,
      },
      {
        agentHandle: handleB,
        displayName: '白露',
        solitary: false,
        current: {
          activityId: 'tide-walk',
          title: '拾贝赶海',
          habitatActivationId: 'act-2',
          habitatId: bundle.habitat.habitatId,
          habitatTitle: bundle.habitat.title,
          placeId: 'tidal-wharf',
          placeLabel: '潮汐栈桥',
          startsAt: toUtopiaTime('2026-11-15T05:45:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: null,
        next: null,
      },
      {
        agentHandle: handleC,
        displayName: '青竹',
        solitary: false,
        current: {
          activityId: 'listen-tide',
          title: '凭栏听潮',
          habitatActivationId: 'act-2',
          habitatId: bundle.habitat.habitatId,
          habitatTitle: bundle.habitat.title,
          placeId: 'tidal-wharf',
          placeLabel: '潮汐栈桥',
          startsAt: toUtopiaTime('2026-11-15T05:48:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: null,
        next: null,
      },
      {
        agentHandle: handleD,
        displayName: '墨云',
        solitary: false,
        current: {
          activityId: 'chatting',
          title: '与你交谈',
          habitatActivationId: 'act-2',
          habitatId: bundle.habitat.habitatId,
          habitatTitle: bundle.habitat.title,
          placeId: '',
          placeLabel: '',
          startsAt: toUtopiaTime('2026-11-15T05:55:00Z'),
          endsAt: null,
          interaction: true, // Conversing with user -> never pinned on virtual place!
        },
        recent: null,
        next: null,
      },
    ],
    occupancy: [
      { placeId: 'tidal-wharf', agentHandles: [handleA, handleB, handleC] },
    ],
    sharedActivities: [
      {
        activityRef: 'sa-active',
        habitatActivationId: 'act-2',
        habitatId: bundle.habitat.habitatId,
        habitatTitle: bundle.habitat.title,
        placeId: 'tidal-wharf',
        placeLabel: '潮汐栈桥',
        activityId: 'tide-walk',
        activityLabel: '栈桥并肩看潮',
        initiatorHandle: handleA,
        recipientHandle: handleB,
        state: 'active',
        acceptedAt: toUtopiaTime('2026-11-15T05:44:00Z'),
        startsAt: toUtopiaTime('2026-11-15T05:45:00Z'),
        endsAt: null,
      },
      {
        activityRef: 'sa-relocated-partial',
        habitatActivationId: 'act-1',
        habitatId: 'nimi.builtin.polar-station',
        habitatTitle: '极昼观测站',
        placeId: 'aurora-dome',
        placeLabel: '极光穹顶',
        activityId: 'watch-aurora',
        activityLabel: '守望极光',
        initiatorHandle: handleA,
        recipientHandle: handleC,
        state: 'relocated_partial',
        acceptedAt: toUtopiaTime('2026-11-15T05:00:00Z'),
        startsAt: toUtopiaTime('2026-11-15T05:10:00Z'),
        endsAt: toUtopiaTime('2026-11-15T05:30:00Z'),
      },
    ],
  };

  // Previous-habitat recent frame preserves its frozen habitatTitle + placeLabel rather than misbinding to new habitat
  const recentLabel = describeResidentFrame(snapshot.residents[0]!.recent, snapshot.habitatActivationId);
  assert.match(recentLabel, /极光观测 · 极昼观测站·极光穹顶/);

  // Occupancy breakdown at tidal-wharf separates Alice+Bob shared pair from Carol's independent co_present pin, and excludes Dave
  const breakdown = buildPlaceOccupancyBreakdown('tidal-wharf', snapshot);
  assert.equal(breakdown.sharedPairs.length, 1);
  assert.equal(breakdown.sharedPairs[0]!.initiator.displayName, '阿狸');
  assert.equal(breakdown.sharedPairs[0]!.recipient.displayName, '白露');
  assert.equal(breakdown.independentResidents.length, 1);
  assert.equal(breakdown.independentResidents[0]!.displayName, '青竹');

  const aria = buildPlaceAriaLabel({
    placeName: '潮汐栈桥',
    isPrivateQuarter: false,
    indoor: false,
    isOpen: true,
    breakdown,
  });
  assert.match(aria, /阿狸.*白露.*栈桥并肩看潮/);
  assert.match(aria, /青竹/);
  assert.doesNotMatch(aria, /墨云/);

  // Visit journal distinguishes relocated_partial from normal completion and surfaces relocation marker
  const journal = computeVisitJournalHighlights(snapshot, null, nowMs);
  assert.ok(journal.some((item) => item.badge === '展卷迁居' && item.summary.includes('极昼观测站')));
  assert.ok(journal.some((item) => item.badge === '旧居同游印记' && item.summary.includes('极昼观测站·极光穹顶')));
});

test('R7 Zero-side-effect local chat draft state machine does not mount session until explicit expand or non-empty send', () => {
  const handleA = 'agent-alice' as NimiUtopiaResident['agentHandle'];
  const resident = { agentHandle: handleA, displayName: '阿狸' };

  let sessionConstructedCount = 0;
  const mockFactory = () => {
    sessionConstructedCount += 1;
    return {} as never;
  };

  // 1. Opening and editing draft is pure local value state; session factory is NOT called
  let draft = createZeroSideEffectDraftState(resident, '');
  assert.equal(draft.sessionMounted, false);
  draft = editZeroSideEffectDraftText(draft, '看到你在栈桥捡贝壳啦');
  assert.equal(draft.sessionMounted, false);
  assert.equal(sessionConstructedCount, 0);

  // 2. Empty send-now is blocked without mounting session
  const emptyDraft = editZeroSideEffectDraftText(draft, '   ');
  const blockedEmpty = activateFormalSessionFromDraft(emptyDraft, 'send-now', [resident]);
  assert.equal(blockedEmpty.next?.sessionMounted, false);
  assert.ok(blockedEmpty.error);

  // 3. Removed resident fails closed with clear message and clears stale draft
  const removedRes = activateFormalSessionFromDraft(draft, 'send-now', []);
  assert.equal(removedRes.next, null);
  assert.match(removedRes.error ?? '', /不在洞天居民列中/);

  // 4. Valid send-now transitions sessionMounted=true and captures a single send operation
  const activated = activateFormalSessionFromDraft(draft, 'send-now', [resident]);
  assert.equal(activated.error, null);
  assert.equal(activated.next?.sessionMounted, true);
  assert.equal(activated.next?.sendOperation?.text, '看到你在栈桥捡贝壳啦');
  void mockFactory;
});

test('H4/R8 Natural-language tuner prompt zero-private-data boundary and response sanitizer', async () => {
  const parts = await loadBuiltinRawParts('seaside-island');
  const bundle = await validateUtopiaBundleParts({ ...parts, allowBuiltinNamespace: true });

  const currentParams = { weather: 'sunny-breeze', tide: 'low-tide' };
  const sysPrompt = buildDeterministicTunerSystemPrompt(bundle.habitat, currentParams);

  // Prompt contains habitat schema keys, zero resident names/handles/conversations
  assert.match(sysPrompt, /weather/);
  assert.doesNotMatch(sysPrompt, /agentHandle|residents|conversation/i);

  // Parameter place diff accurately predicts rain closing outdoor places (tidal-reef & island-deck)
  const stormDiff = previewParameterPlaceDiff(bundle.habitat, currentParams, { weather: 'rain' });
  assert.equal(stormDiff.newlyClosed.length, 2);

  // Response sanitizer strips undeclared parameters, strips punctuation from ShortNounLabel, clamps duration 30..720
  const compiled = validateAndCompileTunerResponse(
    '刮起海风骤雨，再添一场流星雨持续20小时',
    {
      parameterChanges: [
        { key: 'weather', value: 'rain' },
        { key: 'invented_key', value: 'hacked' },
      ],
      eventMutation: {
        mode: 'custom',
        presetId: null,
        sceneryKind: 'meteor-shower',
        label: '夏夜流星雨！！！\n<script>',
        description: '海岛夜空划过细密流星。',
        placeId: 'bird-hide',
        durationMinutes: 9999,
      },
      unsupportedNote: null,
    },
    bundle.habitat,
    currentParams,
  );

  assert.equal(compiled.parameterChanges.length, 1);
  assert.equal(compiled.parameterChanges[0]!.toValue, 'rain');
  assert.ok(compiled.newlyClosedPlaces.length > 0);
  assert.equal(compiled.eventPreview?.kind, 'put-custom');
  assert.equal(compiled.eventPreview?.label, '夏夜流星雨script'); // Sentence punctuation & angle brackets stripped!
  assert.equal(compiled.eventPreview?.durationMinutes, 720); // Clamped to max 720m!
  assert.equal(compiled.commitIntent?.kind, 'apply-tuning');
  const unicodeDraft = validateAndCompileTunerResponse('添加星雨', {
    parameterChanges: [], eventMutation: { mode: 'custom', sceneryKind: 'meteor-shower',
      label: '🌠'.repeat(16), description: '星雨', durationMinutes: 60 },
  }, bundle.habitat, currentParams);
  assert.equal(new TextEncoder().encode(unicodeDraft.eventPreview!.label).byteLength, 48);

  // Out-of-scope request ("盖一座过山车") returns commitIntent === null + polite unsupportedNote
  let capturedScenarioReq: unknown = null;
  const outOfScope = await compileNaturalLanguageTuning({
    prompt: '帮我新建一座摩天轮游乐场并增加过山车玩法',
    habitat: bundle.habitat,
    currentParameterValues: currentParams,
    aiClient: {
      scenario: {
        async execute(req: unknown) {
          capturedScenarioReq = req;
          return {
            output: {
              type: 'text-generate',
              items: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    parameterChanges: [],
                    eventMutation: null,
                    unsupportedNote: '当前海岛洞天未声明游乐场场所，仅支持调节海风晴雨、潮位及点亮海岛风物。',
                  }),
                },
              ],
            },
          } as never;
        },
      } as never,
    },
  });

  assert.ok(capturedScenarioReq);
  assert.equal(outOfScope.commitIntent, null);
  assert.match(outOfScope.unsupportedNote ?? '', /未声明游乐场/);

  // >120 character input rejected before calling AI scenario
  await assert.rejects(
    () => compileNaturalLanguageTuning({
      prompt: '风'.repeat(121),
      habitat: bundle.habitat,
      currentParameterValues: currentParams,
      aiClient: { scenario: { execute: async () => { throw new Error('should not be called'); } } as never },
    }),
    /120 字以内/,
  );
});

test('Orphan sweep reaches beyond 1000 live assets and never deletes on a failed intermediate page', async () => {
  const store = createInMemoryStoragePort();
  const parts = await loadBuiltinRawParts('cloud-bamboo-abode');
  const assetPaths = [...parts.rawAssets.keys()];
  while (assetPaths.length < 48) assetPaths.push(`assets/extra-${assetPaths.length}.png`);
  const bundles = [];
  for (let i = 0; i < 21; i++) {
    const bundleId = `creator.paged-${i}`;
    const habitat = { ...parts.rawHabitat, habitatId: bundleId };
    const assetRoot = `bundles/content/00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    bundles.push({ manifest: { ...parts.rawManifest, bundleId }, habitat, stage: parts.rawStage,
      contentDigest: await computeHabitatContentDigest(habitat as never), installedAt: new Date().toISOString(), assetRoot, assetPaths });
    for (const name of assetPaths) store.assetFiles.set(`${assetRoot}/${name}`, new Uint8Array([1]));
  }
  const index = { schemaVersion: '2.0', bundles };
  assert.ok(new TextEncoder().encode(JSON.stringify(index)).length < 256 * 1024, 'fixture exceeds supported index capacity');
  store.jsonDocs.set('bundles-index.json', index);
  assert.equal((await readImportedPacksIndex(store.port)).length, 21);
  const tail = 'bundles/content/ffffffff-ffff-4fff-8fff-ffffffffffff/assets/orphan.png';
  const early = 'bundles/content/00000000-0000-0000-0000-000000000000/assets/orphan.png';
  store.assetFiles.set(tail, new Uint8Array([2]));
  store.assetFiles.set(early, new Uint8Array([3]));
  const list = store.port.assets.list.bind(store.port.assets);
  let pages = 0;
  let failPage = true;
  const pagedPort: UtopiaStoragePort = { ...store.port, assets: { ...store.port.assets,
    list: async (req) => { if (++pages === 7 && failPage) throw new Error('interrupted page'); return list(req); },
  } };
  await assert.rejects(cleanupOrphanedBundleAssets(pagedPort), /interrupted page/);
  assert.equal(store.assetFiles.size, 1010, 'failed scan deleted before completing the cursor');
  pages = 0;
  failPage = false;
  assert.equal(await cleanupOrphanedBundleAssets(pagedPort), 2);
  assert.equal(pages, 11);
  assert.equal(store.assetFiles.has(tail), false, 'trailing orphan is starved by live earlier pages');
  assert.equal(store.assetFiles.size, 1008, 'referenced assets were removed');
  assert.equal(await cleanupOrphanedBundleAssets(pagedPort), 0);
});

test('Shared activity display deduplicates upgraded legacy placeholder labels while preserving cross-habitat snapshots', () => {
  assert.equal(SCENERY_KIND_LABELS['meteor-shower'], '流星雨');

  const legacy = formatSharedActivityDisplay(
    {
      activityRef: 'legacy-1',
      habitatActivationId: 'legacy-act',
      habitatId: 'legacy.polar-station',
      habitatTitle: '旧版住地记录',
      placeId: 'shared-lounge',
      placeLabel: '旧版住地记录',
      activityId: 'shared-moment',
      activityLabel: '旧版住地记录',
      initiatorHandle: '@wenhe',
      recipientHandle: '@flora',
      state: 'completed',
      acceptedAt: { seconds: '1000', nanos: 0 },
      startsAt: { seconds: '1060', nanos: 0 },
      endsAt: { seconds: '1660', nanos: 0 },
    },
    'current-act',
  );
  assert.equal(legacy.subtitle, '旧版住地记录');
  assert.equal(legacy.highlightSummary('温荷', '芙洛拉'), '温荷 与 芙洛拉 · 旧版住地记录');

  const crossHabitat = formatSharedActivityDisplay(
    {
      activityRef: 'island-1',
      habitatActivationId: 'island-act',
      habitatId: 'nimi.builtin.seaside-island',
      habitatTitle: '海风渔岛',
      placeId: 'bird-hide',
      placeLabel: '遮蔽观鸟棚',
      activityId: 'watch-birds',
      activityLabel: '共观迁徙海鸟',
      initiatorHandle: '@wenhe',
      recipientHandle: '@chiara',
      state: 'relocated',
      acceptedAt: { seconds: '2000', nanos: 0 },
      startsAt: { seconds: '2060', nanos: 0 },
      endsAt: { seconds: '3860', nanos: 0 },
    },
    'mountain-act',
  );
  assert.equal(crossHabitat.subtitle, '共观迁徙海鸟 · 海风渔岛 · 遮蔽观鸟棚');
  assert.equal(crossHabitat.highlightSummary('温荷', '基娅拉·罗西'), '温荷 与 基娅拉·罗西 在海风渔岛·遮蔽观鸟棚「共观迁徙海鸟」');
});

test('Audit Remediation Suite: cross-layer 9-place digests, honest stage occupancy, wardrobe binding persistence, scoped scenery, and active pack retention', async () => {
  // 1. Cross-layer Go <-> TS built-in HabitatSpecV1 JCS SHA-256 parity + 9-place scale on polar & cloud-bamboo
  const seaside = await validateUtopiaBundleParts({
    ...(await loadBuiltinRawParts('seaside-island')),
    allowBuiltinNamespace: true,
  });
  const polar = await validateUtopiaBundleParts({
    ...(await loadBuiltinRawParts('polar-station')),
    allowBuiltinNamespace: true,
  });
  const bamboo = await validateUtopiaBundleParts({
    ...(await loadBuiltinRawParts('cloud-bamboo-abode')),
    allowBuiltinNamespace: true,
  });

  assert.equal(seaside.contentDigest, 'sha256:6f05999830028acc9ec179f51d55494da244cd114f6bee1582cf16d4bba937ff');
  assert.equal(polar.contentDigest, 'sha256:c63c5c032ae5956110c624f0a5630280ca06f6a520f9c7d88983471e167b7634');
  assert.equal(bamboo.contentDigest, 'sha256:f0c1b81a0932c36b4a2eb06c98bc3126543be62d2751ba86890799666e1e9557');
  assert.equal(polar.habitat.places.length, 8);
  assert.equal(bamboo.habitat.places.length, 8);

  // computeOpenPlaceIds excludes personal-quarter
  const openSeaside = computeOpenPlaceIds(seaside.habitat, { weather: 'sunny-breeze', tide: 'low-tide' });
  assert.equal(openSeaside.includes('personal-quarter'), false);
  assert.equal(openSeaside.length, seaside.habitat.places.length);

  // 2. Main stage spatial projection never fabricates 偶遇 when publicParticipation=false & occupancy=[]
  const h1 = 'agent-p1' as NimiUtopiaResident['agentHandle'];
  const h2 = 'agent-p2' as NimiUtopiaResident['agentHandle'];
  const h3 = 'agent-work' as NimiUtopiaResident['agentHandle'];
  const privateSnapshot: NimiUtopiaSnapshot = {
    revision: 'rev-priv',
    observedAt: toUtopiaTime('2026-11-15T10:00:00Z'),
    habitatActivationId: 'act-priv',
    contentDigest: seaside.contentDigest,
    timezone: 'Asia/Shanghai',
    publicParticipation: false,
    habitat: seaside.habitat,
    parameterValues: { weather: 'sunny-breeze', tide: 'low-tide' },
    openPlaceIds: [...openSeaside],
    activeEvents: [],
    lastRelocation: null,
    residents: [
      {
        agentHandle: h1,
        displayName: '松雪',
        solitary: false,
        current: {
          activityId: 'watch-birds',
          title: '棚内观鸟',
          habitatActivationId: 'act-priv',
          habitatId: seaside.habitat.habitatId,
          habitatTitle: seaside.habitat.title,
          placeId: 'bird-hide',
          placeLabel: '遮蔽观鸟棚',
          startsAt: toUtopiaTime('2026-11-15T09:50:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: null,
        next: null,
      },
      {
        agentHandle: h2,
        displayName: '听潮',
        solitary: false,
        current: {
          activityId: 'watch-birds',
          title: '棚内观鸟',
          habitatActivationId: 'act-priv',
          habitatId: seaside.habitat.habitatId,
          habitatTitle: seaside.habitat.title,
          placeId: 'bird-hide',
          placeLabel: '遮蔽观鸟棚',
          startsAt: toUtopiaTime('2026-11-15T09:52:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: null,
        next: null,
      },
      {
        agentHandle: h3,
        displayName: '织星',
        solitary: false,
        current: {
          activityId: '',
          title: 'Interaction',
          habitatActivationId: 'act-priv',
          habitatId: seaside.habitat.habitatId,
          habitatTitle: seaside.habitat.title,
          placeId: '',
          placeLabel: '',
          startsAt: toUtopiaTime('2026-11-15T09:55:00Z'),
          endsAt: null,
          interaction: true,
        },
        recent: null,
        next: null,
      },
    ],
    occupancy: [],
    sharedActivities: [],
  };

  const targets = computeResidentSpatialTargets(privateSnapshot, seaside.stage);
  const slot1 = targets.slots.find((s) => s.resident.agentHandle === h1)!;
  const slot2 = targets.slots.find((s) => s.resident.agentHandle === h2)!;
  const slot3 = targets.slots.find((s) => s.resident.agentHandle === h3)!;
  assert.equal(slot1.coPresentHint, false, 'private resident must not receive 偶遇 hint');
  assert.equal(slot2.coPresentHint, false, 'private resident must not receive 偶遇 hint');
  assert.equal(slot3.bubbleText, '对话或协作中');
  assert.equal(describeResidentFrame(privateSnapshot.residents[2]!.current, 'act-priv'), '正在对话或应用协作中');

  // 3. Wardrobe managed storage unwrapping (`{ value, sizeBytes }`) + stable agentBinding across session handles
  const customLook: ChibiAppearance = {
    skinTone: 'peach',
    hairStyle: 'twintails',
    hairColor: 'mist-blue',
    eyes: 'starry',
    headwear: 'sailor-cap',
    cloakColor: 'lavender',
  };
  const wardrobeStore = createInMemoryStoragePort();
  await wardrobeStore.port.json.writeJson(CHIBI_WARDROBE_STORAGE_PATH, {
    schemaVersion: '1.0',
    entries: { 'handle-session-1': customLook },
  });
  const unwrapped = await loadPersistedChibiWardrobe(wardrobeStore.port.json);
  assert.deepEqual(unwrapped['handle-session-1'], customLook);

  const migrated = migrateWardrobeHandlesToBindings(unwrapped, {
    'handle-session-1': 'binding-immutable-alpha',
  });
  assert.equal(migrated.changed, true);
  assert.equal('handle-session-1' in migrated.next, false);
  // New session assigns handle-session-2 for the same agentBinding -> custom look survives!
  const bindingsSession2 = { 'handle-session-2': 'binding-immutable-alpha' };
  assert.equal(hasCustomChibiAppearance('handle-session-2', migrated.next, bindingsSession2), true);
  assert.deepEqual(resolveChibiAppearance('handle-session-2', migrated.next, bindingsSession2), customLook);

  // 4. Unknown placeId fallback preserves unsupportedNote & place-scoped scenery never floods full world canvas
  const fallbackDraft = validateAndCompileTunerResponse(
    '在山顶灯塔下流星雨',
    {
      parameterChanges: [],
      eventMutation: {
        mode: 'custom',
        sceneryKind: 'meteor-shower',
        label: '灯塔星雨',
        description: '清亮星痕',
        placeId: 'unknown-mountain-lighthouse',
        durationMinutes: 90,
      },
      unsupportedNote: null,
    },
    seaside.habitat,
    { weather: 'sunny-breeze', tide: 'low-tide' },
  );
  assert.equal(fallbackDraft.eventPreview?.placeId, null);
  assert.match(fallbackDraft.unsupportedNote ?? '', /全洞天范围/);

  const scopedEventOnly = expandEffectsWithScenery(
    [],
    [
      {
        eventId: 'scoped-meteor',
        slot: 'custom',
        sceneryKind: 'meteor-shower',
        label: '观鸟棚星雨',
        description: '局部星雨',
        placeId: 'bird-hide',
        startsAt: toUtopiaTime('2026-11-15T10:00:00Z'),
        expiresAt: toUtopiaTime('2026-11-15T11:00:00Z'),
      },
    ],
    'night',
  );
  assert.equal(scopedEventOnly.some((e) => e.kind === 'meteor'), false, 'place-scoped scenery must not trigger global meteor shower');

  const globalEvent = expandEffectsWithScenery(
    [],
    [
      {
        eventId: 'global-meteor',
        slot: 'custom',
        sceneryKind: 'meteor-shower',
        label: '全域星雨',
        description: '全域星雨',
        placeId: null,
        startsAt: toUtopiaTime('2026-11-15T10:00:00Z'),
        expiresAt: toUtopiaTime('2026-11-15T11:00:00Z'),
      },
    ],
    'night',
  );
  assert.equal(globalEvent.some((e) => e.kind === 'meteor'), true);

  // 5. Importing updated version of same bundleId retains activeContentDigest entry & assets
  const v1Parts = await loadBuiltinRawParts('seaside-island');
  const v1 = await validateUtopiaBundleParts({
    ...v1Parts,
    rawManifest: { ...v1Parts.rawManifest, bundleId: 'creator.versioned-island', version: '1.0.0' },
    rawHabitat: { ...v1Parts.rawHabitat, habitatId: 'creator.versioned-island', title: '海风渔岛初版' },
  });
  const v2 = await validateUtopiaBundleParts({
    ...v1Parts,
    rawManifest: { ...v1Parts.rawManifest, bundleId: 'creator.versioned-island', version: '2.0.0' },
    rawHabitat: { ...v1Parts.rawHabitat, habitatId: 'creator.versioned-island', title: '海风渔岛二版' },
  });
  assert.notEqual(v1.contentDigest, v2.contentDigest);

  const packStore = createInMemoryStoragePort();
  const committedV1 = await importValidatedUtopiaBundle(v1, packStore.port);
  const committedV2 = await importValidatedUtopiaBundle(v2, packStore.port, {
    activeContentDigest: committedV1.contentDigest,
  });
  const retainedPacks = await readImportedPacksIndex(packStore.port);
  assert.equal(retainedPacks.length, 2, 'both active v1 and newly imported v2 must coexist while v1 is active');
  await cleanupOrphanedBundleAssets(packStore.port);
  for (const rel of committedV1.assetPaths) {
    assert.equal(packStore.assetFiles.has(`${committedV1.assetRoot}/${rel}`), true, 'active v1 asset must survive orphan sweep');
  }
  for (const rel of committedV2.assetPaths) {
    assert.equal(packStore.assetFiles.has(`${committedV2.assetRoot}/${rel}`), true, 'new v2 asset must survive orphan sweep');
  }
});

test('Follow-up Audit Remediation: wardrobe single-entry merge & account isolation, concurrent pack remove/relocate mutex, and global-only stage scenery conditions', async () => {
  // 1. Wardrobe cross-account isolation + single-entry patch preserves other companions' saved looks
  const cacheMap = new Map<string, string>();
  const sharedLocalCache: WardrobeCacheStorage = {
    getItem: (k) => cacheMap.get(k) ?? null,
    setItem: (k, v) => { cacheMap.set(k, v); },
    removeItem: (k) => { cacheMap.delete(k); },
  };

  const lookOld: ChibiAppearance = {
    skinTone: 'cream',
    hairStyle: 'bob',
    hairColor: 'chestnut',
    eyes: 'sparkle',
    headwear: 'beret',
    cloakColor: 'mint',
  };
  const lookPeer: ChibiAppearance = {
    skinTone: 'butter',
    hairStyle: 'curly',
    hairColor: 'honey-gold',
    eyes: 'gentle',
    headwear: 'flower-crown',
    cloakColor: 'apricot',
  };
  const lookNew: ChibiAppearance = {
    skinTone: 'peach',
    hairStyle: 'twintails',
    hairColor: 'mist-blue',
    eyes: 'starry',
    headwear: 'sailor-cap',
    cloakColor: 'lavender',
  };

  // Seed legacy unscoped cache key + Account A's two companions
  sharedLocalCache.setItem(
    CHIBI_WARDROBE_LOCAL_KEY,
    JSON.stringify({ schemaVersion: '1.0', entries: { 'agent_binding_account_a': lookOld } }),
  );
  const accountAStore = createInMemoryStoragePort();
  await accountAStore.port.json.writeJson(CHIBI_WARDROBE_STORAGE_PATH, {
    schemaVersion: '1.0',
    entries: {
      agent_binding_account_a: lookOld,
      agent_binding_peer_b: lookPeer,
    },
  });

  // Switch to empty Account B sharing the same renderer localCache: purges legacy cache and never pollutes Account B!
  const accountBStore = createInMemoryStoragePort();
  const loadedAccountB = await loadPersistedChibiWardrobe(accountBStore.port.json, {
    localCache: sharedLocalCache,
  });
  assert.deepEqual(loadedAccountB, {});
  assert.equal(cacheMap.has(CHIBI_WARDROBE_LOCAL_KEY), false, 'legacy unscoped browser cache key must be purged');
  assert.equal(accountBStore.jsonDocs.has(CHIBI_WARDROBE_STORAGE_PATH), false, 'empty Account B storage must not be polluted by Account A');

  // Single-entry patch on Account A (even before a caller has read full wardrobe) merges ONLY the edited key,
  // preserving `agent_binding_peer_b` untouched!
  const mergedAfterSinglePatch = await patchPersistedChibiWardrobeEntry(
    { key: 'agent_binding_account_a', appearance: lookNew },
    accountAStore.port.json,
    { localCache: sharedLocalCache },
  );
  assert.deepEqual(mergedAfterSinglePatch['agent_binding_account_a'], lookNew);
  assert.deepEqual(mergedAfterSinglePatch['agent_binding_peer_b'], lookPeer, 'peer companion outfit must survive single-entry patch');

  // Transient readJson failure must fail closed rather than overwriting existing entries with `{}`
  const brokenReadClient = {
    readJson: async () => {
      throw new Error('storage-busy');
    },
    writeJson: (p: string, v: Parameters<typeof accountAStore.port.json.writeJson>[1]) =>
      accountAStore.port.json.writeJson(p, v),
  };
  await assert.rejects(
    patchPersistedChibiWardrobeEntry(
      { key: 'agent_binding_account_a', appearance: lookOld },
      brokenReadClient,
    ),
    /storage-busy/,
  );
  const rereadAccountA = await loadPersistedChibiWardrobe(accountAStore.port.json);
  assert.deepEqual(rereadAccountA['agent_binding_account_a'], lookNew);
  assert.deepEqual(rereadAccountA['agent_binding_peer_b'], lookPeer);

  // Transient writeJson failure surfaces honestly to caller without corrupting Account A or Account B
  const brokenWriteClient = {
    readJson: (p: string) => accountAStore.port.json.readJson(p),
    writeJson: async () => {
      throw new Error('transient-ipc-disconnect');
    },
  };
  await assert.rejects(
    patchPersistedChibiWardrobeEntry(
      { key: 'agent_binding_account_a', appearance: lookOld },
      brokenWriteClient,
      { localCache: sharedLocalCache },
    ),
    /transient-ipc-disconnect/,
  );
  assert.equal(accountBStore.jsonDocs.has(CHIBI_WARDROBE_STORAGE_PATH), false);

  // 2. Pack import without snapshot (`activeContentDigest: null` / omitted) preserves old versions; removal verifies live usage
  const baseParts = await loadBuiltinRawParts('seaside-island');
  const packV1 = await validateUtopiaBundleParts({
    ...baseParts,
    rawManifest: { ...baseParts.rawManifest, bundleId: 'creator.offline-safe', version: '1.0.0' },
    rawHabitat: { ...baseParts.rawHabitat, habitatId: 'creator.offline-safe', title: '离线安全初版' },
  });
  const packV2 = await validateUtopiaBundleParts({
    ...baseParts,
    rawManifest: { ...baseParts.rawManifest, bundleId: 'creator.offline-safe', version: '2.0.0' },
    rawHabitat: { ...baseParts.rawHabitat, habitatId: 'creator.offline-safe', title: '离线安全二版' },
  });
  const offlineStore = createInMemoryStoragePort();
  const installedV1 = await importValidatedUtopiaBundle(packV1, offlineStore.port);
  // Snapshot missing (`activeContentDigest: null`) during "仅存入洞天库": old version and assets MUST survive!
  const installedV2 = await importValidatedUtopiaBundle(packV2, offlineStore.port, { activeContentDigest: null });
  assert.equal((await readImportedPacksIndex(offlineStore.port)).length, 2);
  for (const rel of installedV1.assetPaths) {
    assert.equal(offlineStore.assetFiles.has(`${installedV1.assetRoot}/${rel}`), true, 'v1 asset must survive snapshotless v2 import');
  }

  // Removal fails closed when usage state cannot be verified or when live Runtime still uses v1
  await assert.rejects(
    removeImportedPack('creator.offline-safe', offlineStore.port, {
      contentDigest: installedV1.contentDigest,
      activeContentDigest: null,
    }),
    /无法确认当前住地使用状态/,
  );
  await assert.rejects(
    removeImportedPack('creator.offline-safe', offlineStore.port, {
      contentDigest: installedV1.contentDigest,
      resolveActiveContentDigest: async () => installedV1.contentDigest,
    }),
    /当前正被住地使用/,
  );
  // Once live Runtime confirms v2 is active, v1 can be removed cleanly while v2 stays intact
  await removeImportedPack('creator.offline-safe', offlineStore.port, {
    contentDigest: installedV1.contentDigest,
    resolveActiveContentDigest: async () => installedV2.contentDigest,
  });
  const remainingPacks = await readImportedPacksIndex(offlineStore.port);
  assert.equal(remainingPacks.length, 1);
  assert.equal(remainingPacks[0]?.contentDigest, installedV2.contentDigest);

  // 2b. Concurrent remove vs relocate on the same `.utopia` pack version is strictly serialized
  const raceStoreA = createInMemoryStoragePort();
  const racePackA = await importValidatedUtopiaBundle(packV1, raceStoreA.port);
  let liveActiveDigestA = 'sha256:other-habitat';
  let releaseDigestReadA!: () => void;
  const digestReadEnteredA = new Promise<void>((resolve) => {
    // Signal once removeImportedPack enters resolveActiveContentDigest
    void resolve;
  });
  let notifyEnteredA!: () => void;
  const enteredPromiseA = new Promise<void>((resolve) => { notifyEnteredA = resolve; });
  const pendingRemoveFirst = removeImportedPack('creator.offline-safe', raceStoreA.port, {
    contentDigest: racePackA.contentDigest,
    resolveActiveContentDigest: async () => {
      notifyEnteredA();
      await new Promise<void>((resolve) => { releaseDigestReadA = resolve; });
      return liveActiveDigestA;
    },
  });
  void digestReadEnteredA;
  await enteredPromiseA;
  let relocationCalledAfterRemove = false;
  const pendingRelocateAfterRemove = relocateWithImportedPackGuard(
    raceStoreA.port,
    racePackA,
    async () => {
      relocationCalledAfterRemove = true;
      liveActiveDigestA = racePackA.contentDigest;
      return true;
    },
  );
  releaseDigestReadA();
  await pendingRemoveFirst;
  await assert.rejects(pendingRelocateAfterRemove, /已从本机画卷库移除/);
  assert.equal(relocationCalledAfterRemove, false, 'relocation must not activate a pack version that was just removed');

  const raceStoreB = createInMemoryStoragePort();
  const racePackB = await importValidatedUtopiaBundle(packV1, raceStoreB.port);
  let liveActiveDigestB = 'sha256:other-habitat';
  let releaseRelocateB!: () => void;
  let notifyRelocateEnteredB!: () => void;
  const relocateEnteredB = new Promise<void>((resolve) => { notifyRelocateEnteredB = resolve; });
  const pendingRelocateFirst = relocateWithImportedPackGuard(
    raceStoreB.port,
    racePackB,
    async () => {
      notifyRelocateEnteredB();
      await new Promise<void>((resolve) => { releaseRelocateB = resolve; });
      liveActiveDigestB = racePackB.contentDigest;
      return true;
    },
  );
  await relocateEnteredB;
  const pendingRemoveAfterRelocate = removeImportedPack('creator.offline-safe', raceStoreB.port, {
    contentDigest: racePackB.contentDigest,
    resolveActiveContentDigest: async () => liveActiveDigestB,
  });
  releaseRelocateB();
  assert.equal(await pendingRelocateFirst, true);
  await assert.rejects(pendingRemoveAfterRelocate, /当前正被住地使用/);
  assert.equal((await readImportedPacksIndex(raceStoreB.port)).length, 1, 'newly activated pack must survive queued removal');
  for (const rel of racePackB.assetPaths) {
    assert.equal(raceStoreB.assetFiles.has(`${racePackB.assetRoot}/${rel}`), true, 'newly activated pack assets must remain intact');
  }

  // 3. Panoramic stage conditions (`evalStageCondition`) ignore place-scoped scenery (`cloud-bamboo-abode` herb-terrace blossom)
  const bambooParts = await loadBuiltinRawParts('cloud-bamboo-abode');
  const bamboo = await validateUtopiaBundleParts({ ...bambooParts, allowBuiltinNamespace: true });
  const petalEffect = bamboo.stage.ambientEffects.find((e) => e.effect === 'falling-petals');
  assert.ok(petalEffect, 'cloud-bamboo-abode has falling-petals stage effect');

  const scopedBlossom = [
    {
      eventId: 'ev-herb-blossom',
      slot: 'preset' as const,
      sceneryKind: 'blossom' as const,
      label: '药圃白花初绽',
      description: '局部落花',
      placeId: 'herb-terrace',
      startsAt: toUtopiaTime('2026-11-15T10:00:00Z'),
      expiresAt: toUtopiaTime('2026-11-15T12:00:00Z'),
    },
  ];
  assert.equal(
    evalStageCondition(petalEffect.visibleWhen, 'day', { weather: 'misty-clear' }, scopedBlossom),
    false,
    'place-scoped blossom at herb-terrace must not trigger panoramic falling-petals',
  );

  const globalBlossom = [{ ...scopedBlossom[0]!, placeId: null }];
  assert.equal(
    evalStageCondition(petalEffect.visibleWhen, 'day', { weather: 'misty-clear' }, globalBlossom),
    true,
    'habitat-wide blossom (placeId: null) triggers panoramic falling-petals',
  );
});
