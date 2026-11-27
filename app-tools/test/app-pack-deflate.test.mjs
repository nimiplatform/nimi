import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

import {
  readNimiAppArchive,
  readNimiAppArchiveFromFile,
  writeNimiAppArchive,
  writeNimiAppArchiveToFile,
} from '../lib/app-pack.mjs';
import { buildDefaultStarterFiles } from '../lib/app-scaffold-profiles.mjs';
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

    // Legitimate highly-compressible content (> 8 MiB zeros / repetitive data)
    // must pack cleanly by selectively falling back to Store(0) so the archive
    // stays within the 20x expansion ratio cap on both sync and streaming paths.
    const zerosBuf = Buffer.alloc(10 * 1024 * 1024);
    const syncZerosZip = writeNimiAppArchive([
      { name: 'payload/zeros.bin', bytes: zerosBuf, mode: 0o644 },
    ], { compress: true });
    assert.ok(syncZerosZip.length >= zerosBuf.length / 20, 'sync writer must keep expansion ratio <= 20x');
    const syncZerosRead = readNimiAppArchive(syncZerosZip);
    assert.equal(syncZerosRead.get('payload/zeros.bin').size, zerosBuf.length);
    assert.equal(syncZerosRead.get('payload/zeros.bin').bytes.equals(zerosBuf), true);

    const zerosFilePath = path.join(dir, 'zeros.bin');
    writeFileSync(zerosFilePath, zerosBuf);
    const streamZerosPath = path.join(dir, 'zeros.nimiapp');
    const streamZerosWritten = await writeNimiAppArchiveToFile(streamZerosPath, [
      { name: 'payload/zeros.bin', filePath: zerosFilePath, size: zerosBuf.length, mode: 0o644 },
    ], { compress: true });
    assert.ok(streamZerosWritten.size >= zerosBuf.length / 20, 'streaming writer must keep expansion ratio <= 20x');
    const streamZerosRead = await readNimiAppArchiveFromFile(streamZerosPath);
    assert.equal(streamZerosRead.get('payload/zeros.bin').size, zerosBuf.length);

    // Multi-file highly compressible archive (12 x 1 MiB zeros) keeps ratio <= 20x while still compressing later entries.
    const multiEntries = Array.from({ length: 12 }, (_, idx) => ({
      name: `payload/z-${String(idx).padStart(2, '0')}.bin`,
      bytes: Buffer.alloc(1024 * 1024),
      mode: 0o644,
    }));
    const multiZip = writeNimiAppArchive(multiEntries, { compress: true });
    assert.ok(multiZip.length < 3 * 1024 * 1024, 'multi-file compressible archive still shrinks significantly');
    assert.equal(readNimiAppArchive(multiZip).size, 12);

    // Hand-crafted malicious > 20x Deflate archive is STILL rejected fail-closed by both readers.
    const rawBombComp = deflateRawSync(zerosBuf, { level: 6 });
    const rawBombZip = buildRawZip([{
      name: 'payload/bomb.bin',
      method: 8,
      crc: crc32(zerosBuf),
      uncompressedSize: zerosBuf.length,
      compressed: rawBombComp,
    }]);
    assert.throws(() => readNimiAppArchive(rawBombZip), /expansion ratio exceeds 20x/u);
    const rawBombPath = path.join(dir, 'raw-bomb.nimiapp');
    writeFileSync(rawBombPath, rawBombZip);
    await assert.rejects(() => readNimiAppArchiveFromFile(rawBombPath), /expansion ratio exceeds 20x/u);
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

function writeMinimalAsar(asarPath, filePaths) {
  const root = { files: {} };
  for (const rel of filePaths) {
    const parts = rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      node.files[parts[i]] ??= { files: {} };
      node = node.files[parts[i]];
    }
    node.files[parts[parts.length - 1]] = { size: 0, offset: '0' };
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const header = Buffer.alloc(16);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(json.length + 8, 4);
  header.writeUInt32LE(json.length + 4, 8);
  header.writeUInt32LE(json.length, 12);
  writeFileSync(asarPath, Buffer.concat([header, json]));
}

test('L1-B generated Electron packager stages host-declared sharp closure and enforces platform sharp boundary', async () => {
  const starter = buildDefaultStarterFiles({
    platform: 'desktop',
    carrier: 'electron',
    appTitle: 'Sharp Host',
    cargoPackageName: 'sharp-host-shell',
    nativeBundleIdentifier: 'org.example.sharphost',
    appId: 'org.example.sharphost',
    capabilityResolution: { modules: [], styles: [], views: [], navigation: [] },
    appAccess: [],
    features: [],
  });
  const packagerFile = starter.find((item) => item.path === 'scripts/package-electron-production.mjs');
  assert.ok(packagerFile, 'generated starter must include scripts/package-electron-production.mjs');

  // Extract the exact generated helper functions and exercise them against a
  // real pnpm-style symlinked sharp tree and ASAR header without copying logic.
  const helpersStart = packagerFile.content.indexOf('async function listAsarPaths(');
  assert.ok(helpersStart > 0, 'packager script must define helper functions');
  const helpersBody = packagerFile.content.slice(helpersStart);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'nimi-sharp-stage-'));
  try {
    const appRoot = path.join(dir, 'app');
    const pnpmSharpNm = path.join(appRoot, 'node_modules', '.pnpm', 'sharp@0.35.5', 'node_modules');
    const platformSuffix = process.platform === 'darwin' && process.arch === 'arm64' ? 'darwin-arm64' : 'win32-x64';
    const foreignSuffix = platformSuffix === 'darwin-arm64' ? 'win32-x64' : 'darwin-arm64';
    const pkgDefs = {
      sharp: {
        name: 'sharp',
        version: '0.35.5',
        dependencies: { 'detect-libc': '^2.1.2', '@img/colour': '^1.1.0' },
        optionalDependencies: {
          [`@img/sharp-${platformSuffix}`]: '0.35.5',
          [`@img/sharp-${foreignSuffix}`]: '0.35.5',
        },
      },
      'detect-libc': { name: 'detect-libc', version: '2.1.2' },
      '@img/colour': { name: '@img/colour', version: '1.1.0' },
      [`@img/sharp-${platformSuffix}`]: { name: `@img/sharp-${platformSuffix}`, version: '0.35.5' },
      [`@img/sharp-${foreignSuffix}`]: { name: `@img/sharp-${foreignSuffix}`, version: '0.35.5' },
    };
    for (const [name, manifest] of Object.entries(pkgDefs)) {
      const pkgDir = path.join(pnpmSharpNm, ...name.split('/'));
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(manifest));
      writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = ${JSON.stringify(name)};\n`);
    }
    symlinkSync(path.join(pnpmSharpNm, 'sharp'), path.join(appRoot, 'node_modules', 'sharp'), 'junction');

    const harnessPath = path.join(dir, 'harness.mjs');
    const macosFlag = platformSuffix === 'darwin-arm64';
    const nativePlat = macosFlag ? 'darwin' : 'win32';
    const nativeArch = macosFlag ? 'arm64' : 'x64';
    writeFileSync(
      harnessPath,
      [
        "import { cp, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises';",
        "import path from 'node:path';",
        `const MACOS_BUILD = ${String(macosFlag)};`,
        `const NATIVE_PLATFORM = ${JSON.stringify(nativePlat)};`,
        `const NATIVE_ARCH = ${JSON.stringify(nativeArch)};`,
        `const appRoot = ${JSON.stringify(appRoot)};`,
        'let APP_DECLARES_SHARP = true;',
        'export function setDeclaresSharp(value) { APP_DECLARES_SHARP = value; }',
        helpersBody,
        'export { stageDeclaredSharpRuntime, assertCleanAppBundle };',
      ].join('\n'),
    );

    const mod = await import(pathToFileURL(harnessPath).href);
    const stagedRoot = path.join(dir, 'staged');
    await mod.stageDeclaredSharpRuntime(stagedRoot);
    assert.equal(existsSync(path.join(stagedRoot, 'node_modules', 'sharp', 'package.json')), true);
    assert.equal(existsSync(path.join(stagedRoot, 'node_modules', 'detect-libc', 'package.json')), true);
    assert.equal(existsSync(path.join(stagedRoot, 'node_modules', '@img', 'colour', 'package.json')), true);
    assert.equal(existsSync(path.join(stagedRoot, 'node_modules', '@img', `sharp-${platformSuffix}`, 'package.json')), true);
    assert.equal(existsSync(path.join(stagedRoot, 'node_modules', '@img', `sharp-${foreignSuffix}`, 'package.json')), false);

    // Declared sharp allows target-platform @img/sharp-* but rejects foreign-platform @img/sharp-*.
    const resourcesTarget = path.join(dir, 'res-target');
    mkdirSync(resourcesTarget, { recursive: true });
    writeMinimalAsar(path.join(resourcesTarget, 'app.asar'), [
      'dist-electron/main.js',
      `node_modules/@img/sharp-${platformSuffix}/lib/sharp-${platformSuffix}.node`,
    ]);
    mod.setDeclaresSharp(true);
    await mod.assertCleanAppBundle(resourcesTarget);

    // Undeclared sharp rejects even target-platform @img/sharp-*.
    mod.setDeclaresSharp(false);
    await assert.rejects(() => mod.assertCleanAppBundle(resourcesTarget), /Unexpected contaminated payload entry/u);

    // Declared sharp still rejects foreign-platform @img/sharp-*.
    const resourcesForeign = path.join(dir, 'res-foreign');
    mkdirSync(resourcesForeign, { recursive: true });
    writeMinimalAsar(path.join(resourcesForeign, 'app.asar'), [
      'dist-electron/main.js',
      `node_modules/@img/sharp-${foreignSuffix}/lib/sharp-${foreignSuffix}.node`,
    ]);
    mod.setDeclaresSharp(true);
    await assert.rejects(() => mod.assertCleanAppBundle(resourcesForeign), /Unexpected contaminated payload entry/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
