import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

import {
  readNimiAppArchive,
  readNimiAppArchiveFromFile,
  writeNimiAppArchive,
  writeNimiAppArchiveToFile,
} from '../lib/app-pack.mjs';
import { SYMBOLIC_LINK_MODE, validatePayloadLinks } from '../lib/payload-links.mjs';

function buildRawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const rawName = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'utf8');
    const localName = e.localName ?? rawName;
    const method = e.method ?? 0;
    const localMethod = e.localMethod ?? method;
    const flags = e.flags ?? 0x0800;
    const localFlags = e.localFlags ?? flags;
    const modTime = e.modTime ?? 0;
    const modDate = e.modDate ?? 0x0021;
    const payload = e.compressed;
    const uncomp = e.uncompressedSize ?? payload.length;
    const expectedCrc = e.crc ?? 0;
    const extAttrs = e.externalAttrs ?? 0x81A40000;
    const entryOffset = e.localOffset ?? offset;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(localFlags, 6);
    lh.writeUInt16LE(localMethod, 8);
    lh.writeUInt16LE(modTime, 10);
    lh.writeUInt16LE(modDate, 12);
    lh.writeUInt32LE(expectedCrc >>> 0, 14);
    lh.writeUInt32LE(payload.length >>> 0, 18);
    lh.writeUInt32LE(uncomp >>> 0, 22);
    lh.writeUInt16LE(localName.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, localName, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0314, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(modTime, 12);
    ch.writeUInt16LE(modDate, 14);
    ch.writeUInt32LE(expectedCrc >>> 0, 16);
    ch.writeUInt32LE(payload.length >>> 0, 20);
    ch.writeUInt32LE(uncomp >>> 0, 24);
    ch.writeUInt16LE(rawName.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(extAttrs >>> 0, 38);
    ch.writeUInt32LE(entryOffset >>> 0, 42);
    centrals.push(ch, rawName);
    offset += lh.length + localName.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length >>> 0, 12);
  eocd.writeUInt32LE(offset >>> 0, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

test('L2 sync and streaming archives round-trip Deflate 32/64 KiB boundaries, 0 B empty files, Store-only mode, and UTF-8 byte order', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nimi-l2-rt-'));
  try {
    const exact32k = Buffer.from('0123456789abcdef'.repeat(2048));
    const exact64k = Buffer.from('fedcba9876543210'.repeat(4096));
    const incompressible = Buffer.from([0, 1, 2, 3, 4]);
    // Non-BMP U+1F600 (UTF-8: F0 9F 98 80) vs U+FF00 (UTF-8: EF BC 80):
    // UTF-8 byte order puts U+FF00 BEFORE U+1F600, opposite to UTF-16 code units!
    const bmpName = 'payload/\uFF00-bmp.txt';
    const nonBmpName = 'payload/\u{1F600}-nonbmp.txt';

    const entries = [
      { name: nonBmpName, bytes: Buffer.from('emoji'), mode: 0o644 },
      { name: bmpName, bytes: Buffer.from('bmp'), mode: 0o644 },
      { name: 'payload/__init__.py', bytes: Buffer.alloc(0), mode: 0o644 },
      { name: 'payload/exact-32k.txt', bytes: exact32k, mode: 0o644 },
      { name: 'payload/exact-64k.txt', bytes: exact64k, mode: 0o644 },
      { name: 'payload/tiny.bin', bytes: incompressible, mode: 0o755 },
    ];
    const storeBuf = writeNimiAppArchive(entries, { compress: false });
    const deflateBuf = writeNimiAppArchive(entries, { compress: true });
    assert.ok(deflateBuf.length < storeBuf.length / 10, 'Deflate must shrink compressible entries');

    const decodedSync = readNimiAppArchive(deflateBuf);
    const keys = [...decodedSync.keys()];
    assert.ok(keys.indexOf(bmpName) < keys.indexOf(nonBmpName), 'must sort by UTF-8 bytes, not UTF-16');
    assert.equal(decodedSync.get('payload/__init__.py').size, 0);
    assert.deepEqual(decodedSync.get('payload/__init__.py').bytes, Buffer.alloc(0));
    assert.deepEqual(decodedSync.get('payload/exact-32k.txt').bytes, exact32k);
    assert.deepEqual(decodedSync.get('payload/exact-64k.txt').bytes, exact64k);
    assert.deepEqual(decodedSync.get('payload/tiny.bin').bytes, incompressible);

    // Streaming round-trip with > 32 MiB file triggers single-stream Deflate shard path.
    const bigFilePath = path.join(dir, 'big.bin');
    // 34 MiB mix of high-entropy (10 MiB LCG) + compressible (24 MiB) => ~3.4x ratio (well under 20x).
    const bigBuf = Buffer.alloc(34 * 1024 * 1024);
    let seed = 0x12345678;
    for (let i = 0; i < 10 * 1024 * 1024; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bigBuf.writeUInt32LE(seed, i);
    }
    bigBuf.fill(0x41, 10 * 1024 * 1024);
    writeFileSync(bigFilePath, bigBuf);

    const outPath = path.join(dir, 'stream.nimiapp');
    const written = await writeNimiAppArchiveToFile(outPath, [
      ...entries,
      { name: 'payload/big.bin', filePath: bigFilePath, size: bigBuf.length, mode: 0o644 },
    ], { compress: true });
    assert.ok(written.size < bigBuf.length, 'streaming >32 MiB entry must compress');

    const streamed = await readNimiAppArchiveFromFile(outPath, {
      retainPredicate: (name) => name === 'payload/__init__.py' || name === 'payload/exact-32k.txt',
    });
    assert.equal(streamed.get('payload/big.bin').bytes, null, 'unretained large entry must not stay in RAM');
    assert.equal(streamed.get('payload/big.bin').size, bigBuf.length);
    assert.deepEqual(streamed.get('payload/__init__.py').bytes, Buffer.alloc(0));
    assert.deepEqual(streamed.get('payload/exact-32k.txt').bytes, exact32k);

    // Explicitly confirm > 20x expansion ratio above 8 MiB is rejected fail-closed.
    const bombFilePath = path.join(dir, 'zeros.bin');
    writeFileSync(bombFilePath, Buffer.alloc(10 * 1024 * 1024));
    await assert.rejects(
      () => writeNimiAppArchiveToFile(path.join(dir, 'bomb.nimiapp'), [
        { name: 'payload/zeros.bin', filePath: bombFilePath, size: 10 * 1024 * 1024, mode: 0o644 },
      ], { compress: true }),
      /expansion ratio exceeds 20x/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('L2 sync and streaming readers reject BFINAL trailing bytes, createInflateRaw overflow, dirty externalAttrs, and Local/Central mismatch', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nimi-l2-neg-'));
  try {
    const plain = Buffer.alloc(256 * 1024, 0x41);
    const comp = deflateRawSync(plain, { level: 6 });

    for (const tailSize of [1, 4095, 100 * 1024]) {
      const smuggled = buildRawZip([{
        name: 'payload/a.txt',
        method: 8,
        crc: crc32(plain),
        uncompressedSize: plain.length,
        compressed: Buffer.concat([comp, Buffer.alloc(tailSize, 0x42)]),
      }]);
      assert.throws(() => readNimiAppArchive(smuggled), /Invalid.*trailing|length/u);
      const filePath = path.join(dir, `tail-${tailSize}.zip`);
      writeFileSync(filePath, smuggled);
      await assert.rejects(() => readNimiAppArchiveFromFile(filePath), /Invalid.*trailing|length/u);
    }

    // Streaming overflow test: lied uncompressedSize < actual inflated length (proves consumer guards createInflateRaw!).
    const liedUncomp = buildRawZip([{
      name: 'payload/bomb.txt',
      method: 8,
      crc: crc32(plain),
      uncompressedSize: comp.length + 10, // strictly > comp.length so header passes, but << 256 KiB!
      compressed: comp,
    }]);
    assert.throws(() => readNimiAppArchive(liedUncomp), /Invalid/u);
    const bombPath = path.join(dir, 'bomb.zip');
    writeFileSync(bombPath, liedUncomp);
    await assert.rejects(() => readNimiAppArchiveFromFile(bombPath), /Invalid.*overflow/u);

    // Dirty externalAttrs low bits (must be exact 3-value set).
    const dirtyAttr = buildRawZip([{
      name: 'payload/a.txt',
      method: 0,
      crc: crc32(Buffer.from('hi')),
      uncompressedSize: 2,
      compressed: Buffer.from('hi'),
      externalAttrs: 0x81A40001,
    }]);
    assert.throws(() => readNimiAppArchive(dirtyAttr), /Invalid.*mode attributes/u);

    // Legacy fileType == 0 externalAttrs (no longer exempted!).
    const zeroFileType = buildRawZip([{
      name: 'payload/a.txt',
      method: 0,
      crc: crc32(Buffer.from('hi')),
      uncompressedSize: 2,
      compressed: Buffer.from('hi'),
      externalAttrs: 0o644 << 16,
    }]);
    assert.throws(() => readNimiAppArchive(zeroFileType), /Invalid.*mode attributes/u);

    // Local/Central header mismatch.
    const mismatch = buildRawZip([{
      name: 'payload/a.txt',
      method: 0,
      localFlags: 0,
      crc: crc32(Buffer.from('hi')),
      uncompressedSize: 2,
      compressed: Buffer.from('hi'),
    }]);
    assert.throws(() => readNimiAppArchive(mismatch), /Invalid.*local header mismatch/u);

    // Invalid UTF-8 entry name.
    const badUtf8 = buildRawZip([{
      name: Buffer.from([0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64, 0x2f, 0xff]),
      method: 0,
      crc: crc32(Buffer.from('x')),
      uncompressedSize: 1,
      compressed: Buffer.from('x'),
    }]);
    assert.throws(() => readNimiAppArchive(badUtf8), /Invalid.*UTF-8/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('L2 macOS symlink validation uses component-by-component resolution with 32-hop limit', () => {
  // Escape via intermediate symlink followed by ..
  const escapeEntries = new Map([
    ['payload/a/b/c', { mode: SYMBOLIC_LINK_MODE, bytes: Buffer.from('..') }],
    ['payload/a/b/escape', { mode: SYMBOLIC_LINK_MODE, bytes: Buffer.from('c/../../manifest.json') }],
    ['payload/a/file.txt', { mode: 0o644, bytes: Buffer.from('ok') }],
    ['manifest.json', { mode: 0o644, bytes: Buffer.from('{}') }],
  ]);
  assert.throws(() => validatePayloadLinks(escapeEntries, 'macos'), /escapes/u);

  // 33-hop chain exceeds XNU 32-hop limit.
  const chainEntries = new Map([['payload/dir/target', { mode: 0o644, bytes: Buffer.from('ok') }]]);
  for (let i = 0; i < 33; i += 1) {
    chainEntries.set(`payload/dir/l${i}`, {
      mode: SYMBOLIC_LINK_MODE,
      bytes: Buffer.from(i < 32 ? `l${i + 1}` : 'target'),
    });
  }
  assert.throws(() => validatePayloadLinks(chainEntries, 'macos'), /Excessive/u);

  // Invalid UTF-8 symlink target rejected.
  const badTarget = new Map([
    ['payload/a/link', { mode: SYMBOLIC_LINK_MODE, bytes: Buffer.from([0xff, 0xfe]) }],
  ]);
  assert.throws(() => validatePayloadLinks(badTarget, 'macos'), /Invalid payload symbolic link/u);

  // Legitimate sibling parent traversal `../sibling/file` allowed.
  const legit = new Map([
    ['payload/sibling/file', { mode: 0o644, bytes: Buffer.from('ok') }],
    ['payload/a/to-sibling', { mode: SYMBOLIC_LINK_MODE, bytes: Buffer.from('../sibling/file') }],
  ]);
  validatePayloadLinks(legit, 'macos');
});
