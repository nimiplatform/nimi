import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashAppArchive, readAppArchiveFile, writeAppArchiveFile } from '../lib/app-pack.mjs';

test('App archive hash and file I/O support a ZIP32 payload above the native int32 input limit', () => {
  const bytes = Buffer.alloc(0x80000001);
  // Independent Python hashlib reference for 2 GiB + 1 zero bytes.
  assert.equal(hashAppArchive(bytes), 'b8030a8ab89280935633d8d991da3d9907c0f12e8b6fc3bfc515f4d440872b6e');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nimi-large-archive-'));
  const file = path.join(directory, 'large.nimiapp');
  try {
    writeAppArchiveFile(file, bytes);
    const read = readAppArchiveFile(file);
    assert.equal(read.length, bytes.length);
    assert.equal(read.equals(bytes), true);
  } finally { unlinkSync(file); rmdirSync(directory); }
});
