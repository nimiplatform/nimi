import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fail } from './third-party-hardcut-evidence-core.mjs';

function normalizedPath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function safeLstat(candidate, missingCode = 'RAW_ARTIFACT_MISSING') {
  try {
    return fs.lstatSync(candidate, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') fail(missingCode, 'packet artifact is missing');
    throw error;
  }
}

function requirePositiveSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(code, 'canonical packet resource policy is invalid');
  }
}

export function setUniquePacketPathEntry(inventory, key, value) {
  if (inventory.has(key)) {
    fail('PACKET_PATH_KEY_COLLISION', 'packet inventory contains an ambiguous key');
  }
  inventory.set(key, value);
}

export class PacketArtifactStore {
  constructor(packetRoot, resourcePolicy, privacyPolicy) {
    try {
      this.root = fs.realpathSync.native(packetRoot);
    } catch {
      fail('RAW_ARTIFACT_MISSING', 'packet root cannot be canonicalized');
    }
    for (const [field, code] of [
      ['max_file_count', 'PACKET_FILE_COUNT_EXCEEDED'],
      ['max_entry_count', 'PACKET_ENTRY_COUNT_EXCEEDED'],
      ['max_directory_depth', 'PACKET_DIRECTORY_DEPTH_EXCEEDED'],
      ['max_single_file_bytes', 'PACKET_FILE_TOO_LARGE'],
      ['max_packet_total_bytes', 'PACKET_TOTAL_TOO_LARGE'],
      ['max_text_scan_bytes', 'TEXT_SCAN_TOO_LARGE'],
      ['max_screenshot_compressed_bytes', 'SCREENSHOT_COMPRESSED_TOO_LARGE'],
      ['stream_chunk_bytes', 'PACKET_RESOURCE_POLICY_INVALID'],
    ]) {
      requirePositiveSafeInteger(resourcePolicy?.[field], code);
    }
    if (!Array.isArray(privacyPolicy?.text_extensions)) {
      fail('PACKET_RESOURCE_POLICY_INVALID', 'canonical privacy text extensions are missing');
    }
    if (resourcePolicy.max_file_count > resourcePolicy.max_entry_count) {
      fail('PACKET_RESOURCE_POLICY_INVALID', 'canonical packet resource policy is inconsistent');
    }
    if (resourcePolicy.path_key_collision_posture !== 'reject') {
      fail('PACKET_RESOURCE_POLICY_INVALID', 'canonical packet path policy is invalid');
    }
    this.resourcePolicy = resourcePolicy;
    this.textExtensions = new Set(privacyPolicy.text_extensions);
    this.entryInventory = new Map();
    this.inventory = new Map();
    this.records = new Map();
    this.scanCompleted = false;
    this.#buildInventory();
  }

  #relativeKey(relativePath) {
    return normalizedPath(path.relative(this.root, path.resolve(this.root, relativePath)));
  }

  #walkEntries({ missingCode, invalidEntryCode }, visitEntry) {
    const stack = [{ directory: this.root, relativeDirectory: '', depth: 0 }];
    let entryCount = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      let directory;
      try {
        directory = fs.opendirSync(current.directory);
        while (true) {
          const entry = directory.readSync();
          if (entry === null) break;
          entryCount += 1;
          if (entryCount > this.resourcePolicy.max_entry_count) {
            fail('PACKET_ENTRY_COUNT_EXCEEDED', 'packet contains too many filesystem entries');
          }
          const relativePath = path.join(current.relativeDirectory, entry.name);
          const candidate = path.join(current.directory, entry.name);
          const stat = safeLstat(candidate, missingCode);
          if (stat.isSymbolicLink()) {
            fail(invalidEntryCode, 'packet inventory contains a reparse point');
          }
          let kind;
          let depth = current.depth;
          if (stat.isDirectory()) {
            kind = 'directory';
            depth += 1;
            if (depth > this.resourcePolicy.max_directory_depth) {
              fail('PACKET_DIRECTORY_DEPTH_EXCEEDED', 'packet directory nesting is too deep');
            }
          } else if (stat.isFile()) {
            kind = 'file';
          } else {
            fail(invalidEntryCode, 'packet inventory contains a non-regular entry');
          }
          visitEntry({ candidate, depth, kind, relativePath, stat });
          if (kind === 'directory') {
            stack.push({
              directory: candidate,
              relativeDirectory: relativePath,
              depth,
            });
          }
        }
      } finally {
        directory?.closeSync();
      }
    }
  }

  #buildInventory() {
    let fileCount = 0;
    let totalBytes = 0n;
    this.#walkEntries(
      {
        missingCode: 'RAW_ARTIFACT_MISSING',
        invalidEntryCode: 'RAW_ARTIFACT_REPARSE_POINT',
      },
      ({ candidate, kind, relativePath, stat }) => {
        const key = normalizedPath(relativePath);
        setUniquePacketPathEntry(this.entryInventory, key, Object.freeze({
          identity: stat,
          kind,
        }));
        if (kind === 'directory') return;
        fileCount += 1;
        if (fileCount > this.resourcePolicy.max_file_count) {
          fail('PACKET_FILE_COUNT_EXCEEDED', 'packet contains too many files');
        }
        if (stat.size > BigInt(this.resourcePolicy.max_single_file_bytes)) {
          fail('PACKET_FILE_TOO_LARGE', 'packet file exceeds the canonical byte limit');
        }
        const extension = path.extname(relativePath).toLowerCase();
        if (
          this.textExtensions.has(extension)
          && stat.size > BigInt(this.resourcePolicy.max_text_scan_bytes)
        ) {
          fail('TEXT_SCAN_TOO_LARGE', 'recognized text exceeds the canonical scan limit');
        }
        totalBytes += stat.size;
        if (totalBytes > BigInt(this.resourcePolicy.max_packet_total_bytes)) {
          fail('PACKET_TOTAL_TOO_LARGE', 'packet exceeds the canonical aggregate byte limit');
        }
        setUniquePacketPathEntry(this.inventory, key, Object.freeze({
          absolutePath: candidate,
          identity: stat,
          relativePath: relativePath.replaceAll('\\', '/'),
          size: Number(stat.size),
        }));
      },
    );
  }

  #resolveInventoryEntry(relativePath) {
    if (
      typeof relativePath !== 'string'
      || relativePath.length === 0
      || relativePath.includes('\0')
      || path.isAbsolute(relativePath)
    ) {
      fail('RAW_ARTIFACT_OUTSIDE_PACKET', 'artifact reference is not packet-relative');
    }
    const candidate = path.resolve(this.root, relativePath);
    if (!isWithin(this.root, candidate)) {
      fail('RAW_ARTIFACT_OUTSIDE_PACKET', 'artifact reference escapes the packet');
    }
    let cursor = this.root;
    const segments = path.relative(this.root, candidate).split(path.sep);
    for (const [index, segment] of segments.entries()) {
      cursor = path.join(cursor, segment);
      const stat = safeLstat(cursor);
      if (stat.isSymbolicLink()) {
        fail('RAW_ARTIFACT_REPARSE_POINT', 'packet artifacts cannot traverse reparse points');
      }
      if (index < segments.length - 1 && !stat.isDirectory()) {
        fail('RAW_ARTIFACT_MISSING', 'packet artifact parent is not a directory');
      }
    }
    let canonicalPath;
    try {
      canonicalPath = fs.realpathSync.native(candidate);
    } catch {
      fail('RAW_ARTIFACT_MISSING', 'packet artifact cannot be canonicalized');
    }
    if (!isWithin(this.root, canonicalPath) || normalizedPath(canonicalPath) !== normalizedPath(candidate)) {
      fail('RAW_ARTIFACT_OUTSIDE_PACKET', 'packet artifact resolves outside its trusted path');
    }
    const key = this.#relativeKey(relativePath);
    const inventoryEntry = this.inventory.get(key);
    if (!inventoryEntry) {
      fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact appeared after inventory');
    }
    const current = safeLstat(candidate, 'ARTIFACT_IDENTITY_CHANGED');
    if (!current.isFile() || !sameIdentity(inventoryEntry.identity, current)) {
      fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact changed after inventory');
    }
    return { key, inventoryEntry };
  }

  #consumeOpenFile(inventoryEntry, consume) {
    let descriptor;
    let opened;
    let afterRead;
    let result;
    try {
      const noFollow = fs.constants.O_NOFOLLOW ?? 0;
      descriptor = fs.openSync(inventoryEntry.absolutePath, fs.constants.O_RDONLY | noFollow);
      opened = fs.fstatSync(descriptor, { bigint: true });
      if (!opened.isFile() || !sameIdentity(inventoryEntry.identity, opened)) {
        fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact identity changed while opening');
      }
      result = consume(descriptor);
      afterRead = fs.fstatSync(descriptor, { bigint: true });
      if (!sameIdentity(opened, afterRead)) {
        fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact changed while reading');
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    const afterPath = safeLstat(inventoryEntry.absolutePath, 'ARTIFACT_IDENTITY_CHANGED');
    if (!sameIdentity(afterRead, afterPath)) {
      fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact path identity changed after reading');
    }
    return { identity: afterPath, result };
  }

  read(relativePath, expectedSha256 = null, options = {}) {
    const { key, inventoryEntry } = this.#resolveInventoryEntry(relativePath);
    if (
      options.maxBytes !== undefined
      && inventoryEntry.size > options.maxBytes
    ) {
      fail(options.limitCode ?? 'PACKET_FILE_TOO_LARGE', 'artifact exceeds its canonical byte limit');
    }
    const existing = this.records.get(key);
    if (existing) {
      if (!existing.bytes) {
        fail('ARTIFACT_NOT_RETAINED', 'unreferenced streamed artifact bytes were not retained');
      }
      if (expectedSha256 && existing.sha256 !== expectedSha256) {
        fail('ARTIFACT_HASH_MISMATCH', 'packet artifact SHA-256 does not match');
      }
      return existing;
    }
    const { identity, result } = this.#consumeOpenFile(inventoryEntry, (descriptor) => {
      const bytes = fs.readFileSync(descriptor);
      if (bytes.length !== inventoryEntry.size) {
        fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact length changed while reading');
      }
      return bytes;
    });
    const sha256 = crypto.createHash('sha256').update(result).digest('hex');
    if (expectedSha256 && sha256 !== expectedSha256) {
      fail('ARTIFACT_HASH_MISMATCH', 'packet artifact SHA-256 does not match');
    }
    const artifact = Object.freeze({
      bytes: result,
      identity,
      relativePath: inventoryEntry.relativePath,
      sha256,
    });
    this.records.set(key, artifact);
    return artifact;
  }

  scanAll(createSink) {
    if (this.scanCompleted) {
      fail('PACKET_SCAN_ALREADY_COMPLETED', 'packet privacy scan may run only once');
    }
    for (const [key, inventoryEntry] of this.inventory) {
      const sink = createSink({
        relativePath: inventoryEntry.relativePath,
        size: inventoryEntry.size,
      });
      if (!sink || typeof sink.write !== 'function' || typeof sink.end !== 'function') {
        fail('PACKET_SCANNER_INVALID', 'packet scanner did not provide a streaming sink');
      }
      const existing = this.records.get(key);
      if (existing?.bytes) {
        sink.write(existing.bytes);
        sink.end();
        continue;
      }
      if (existing) {
        fail('PACKET_SCAN_ALREADY_COMPLETED', 'packet artifact was already streamed');
      }
      const hash = crypto.createHash('sha256');
      const { identity } = this.#consumeOpenFile(inventoryEntry, (descriptor) => {
        const buffer = Buffer.allocUnsafe(this.resourcePolicy.stream_chunk_bytes);
        let totalRead = 0;
        while (true) {
          const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
          if (bytesRead === 0) break;
          const chunk = buffer.subarray(0, bytesRead);
          totalRead += bytesRead;
          hash.update(chunk);
          sink.write(chunk);
        }
        if (totalRead !== inventoryEntry.size) {
          fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact length changed while streaming');
        }
      });
      sink.end();
      this.records.set(key, Object.freeze({
        bytes: null,
        identity,
        relativePath: inventoryEntry.relativePath,
        sha256: hash.digest('hex'),
      }));
    }
    this.scanCompleted = true;
  }

  assertStable() {
    if (!this.scanCompleted || this.records.size !== this.inventory.size) {
      fail('ARTIFACT_IDENTITY_CHANGED', 'packet scan did not cover the complete inventory');
    }
    const currentInventory = new Map();
    this.#walkEntries(
      {
        missingCode: 'ARTIFACT_IDENTITY_CHANGED',
        invalidEntryCode: 'ARTIFACT_IDENTITY_CHANGED',
      },
      ({ kind, relativePath, stat }) => {
        setUniquePacketPathEntry(
          currentInventory,
          normalizedPath(relativePath),
          { identity: stat, kind },
        );
      },
    );
    if (currentInventory.size !== this.entryInventory.size) {
      fail('ARTIFACT_IDENTITY_CHANGED', 'packet inventory changed during validation');
    }
    for (const [key, inventoryEntry] of this.entryInventory) {
      const current = currentInventory.get(key);
      if (
        !current
        || current.kind !== inventoryEntry.kind
        || !sameIdentity(inventoryEntry.identity, current.identity)
      ) {
        fail('ARTIFACT_IDENTITY_CHANGED', 'packet artifact identity changed during validation');
      }
    }
  }
}

export function resolvePacketArtifact(artifactStore, artifactRef) {
  return artifactStore.read(artifactRef);
}

export function resolveAndVerifyPacketArtifact(artifactStore, artifact, options = {}) {
  if (typeof artifact === 'string') {
    artifactStore.read(artifact, null, options);
    fail('ARTIFACT_HASH_MISSING', 'artifact reference has no SHA-256');
  }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    fail('ARTIFACT_HASH_MISSING', 'artifact reference must carry path and SHA-256');
  }
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
    fail('ARTIFACT_HASH_MISSING', 'artifact SHA-256 is missing or malformed');
  }
  return artifactStore.read(artifact.path, artifact.sha256, options);
}
