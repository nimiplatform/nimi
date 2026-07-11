import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PacketArtifactStore,
  setUniquePacketPathEntry,
} from './lib/third-party-hardcut-evidence-paths.mjs';

const RESOURCE_POLICY = {
  version: 1,
  path_key_collision_posture: 'reject',
  max_file_count: 512,
  max_entry_count: 1024,
  max_directory_depth: 32,
  max_single_file_bytes: 16 * 1024 * 1024,
  max_packet_total_bytes: 128 * 1024 * 1024,
  max_text_scan_bytes: 4 * 1024 * 1024,
  max_screenshot_compressed_bytes: 16 * 1024 * 1024,
  stream_chunk_bytes: 64 * 1024,
};
const PRIVACY_POLICY = { text_extensions: ['.txt'] };
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(scriptDir, 'check-third-party-hardcut-evidence.mjs');
const repoRoot = path.join(scriptDir, '..');

function withPacketRoot(prefix, execute) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    execute(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function enableWindowsCaseSensitivity(root) {
  if (process.platform !== 'win32') return false;
  const result = spawnSync(
    'fsutil.exe',
    ['file', 'SetCaseSensitiveInfo', root, 'enable'],
    { encoding: 'utf8', windowsHide: true },
  );
  return result.status === 0;
}

test('rejects colliding inventory keys through a platform-independent insertion primitive', () => {
  const inventory = new Map();
  setUniquePacketPathEntry(inventory, 'normalized/path', { safe: true });
  assert.throws(
    () => setUniquePacketPathEntry(
      inventory,
      'normalized/path',
      { safe: false },
    ),
    (error) => {
      assert.equal(error.code, 'PACKET_PATH_KEY_COLLISION');
      assert.doesNotMatch(error.message, /normalized|path|safe/iu);
      return true;
    },
  );
});

test('rejects an initial Windows case-sensitive path-key collision', (context) => {
  withPacketRoot('nimi-hardcut-case-collision-', (root) => {
    if (!enableWindowsCaseSensitivity(root)) {
      context.skip('Windows case-sensitive directories are unavailable');
      return;
    }
    fs.writeFileSync(path.join(root, 'A.bin'), 'nimi-synthetic-binary-canary-v1');
    fs.writeFileSync(path.join(root, 'a.bin'), 'safe');
    assert.deepEqual(fs.readdirSync(root).sort(), ['A.bin', 'a.bin']);
    assert.throws(
      () => new PacketArtifactStore(root, RESOURCE_POLICY, PRIVACY_POLICY),
      (error) => {
        assert.equal(error.code, 'PACKET_PATH_KEY_COLLISION');
        assert.doesNotMatch(error.message, /A\.bin|a\.bin|synthetic|canary/iu);
        return true;
      },
    );
  });
});

test('CLI returns a stable sanitized code for a Windows path-key collision', (context) => {
  withPacketRoot('nimi-hardcut-case-cli-', (root) => {
    if (!enableWindowsCaseSensitivity(root)) {
      context.skip('Windows case-sensitive directories are unavailable');
      return;
    }
    fs.writeFileSync(path.join(root, 'A.bin'), 'nimi-synthetic-binary-canary-v1');
    fs.writeFileSync(path.join(root, 'a.bin'), 'safe');
    const result = spawnSync(
      process.execPath,
      [cliPath, '--packet', root, '--repo', `nimi=${repoRoot}`],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '[PACKET_PATH_KEY_COLLISION] validation rejected\n');
    assert.doesNotMatch(result.stderr, /A\.bin|a\.bin|synthetic|canary/iu);
  });
});

test('rejects a Windows case-sensitive collision introduced after inventory', (context) => {
  withPacketRoot('nimi-hardcut-case-stability-', (root) => {
    if (!enableWindowsCaseSensitivity(root)) {
      context.skip('Windows case-sensitive directories are unavailable');
      return;
    }
    fs.writeFileSync(path.join(root, 'a.bin'), 'safe');
    const store = new PacketArtifactStore(root, RESOURCE_POLICY, PRIVACY_POLICY);
    store.scanAll(() => ({ write() {}, end() {} }));
    fs.writeFileSync(path.join(root, 'A.bin'), 'nimi-synthetic-binary-canary-v1');
    assert.throws(
      () => store.assertStable(),
      (error) => {
        assert.equal(error.code, 'PACKET_PATH_KEY_COLLISION');
        assert.doesNotMatch(error.message, /A\.bin|a\.bin|synthetic|canary/iu);
        return true;
      },
    );
  });
});

test('rejects packet file-count overflow during stat-only inventory', () => {
  withPacketRoot('nimi-hardcut-limit-count-', (root) => {
    fs.writeFileSync(path.join(root, 'one.bin'), '1');
    fs.writeFileSync(path.join(root, 'two.bin'), '2');
    fs.writeFileSync(path.join(root, 'three.bin'), '3');
    assert.throws(
      () => new PacketArtifactStore(root, {
        ...RESOURCE_POLICY,
        max_file_count: 2,
      }, PRIVACY_POLICY),
      (error) => error.code === 'PACKET_FILE_COUNT_EXCEEDED',
    );
  });
});

test('rejects wide empty-directory packets at the entry budget', () => {
  withPacketRoot('nimi-hardcut-limit-entry-', (root) => {
    fs.mkdirSync(path.join(root, 'wide-one'));
    fs.mkdirSync(path.join(root, 'wide-two'));
    fs.mkdirSync(path.join(root, 'wide-three'));
    assert.throws(
      () => new PacketArtifactStore(root, {
        ...RESOURCE_POLICY,
        max_file_count: 2,
        max_entry_count: 2,
      }, PRIVACY_POLICY),
      (error) => {
        assert.equal(error.code, 'PACKET_ENTRY_COUNT_EXCEEDED');
        assert.doesNotMatch(error.message, /wide-/u);
        return true;
      },
    );
  });
});

test('rejects deep empty-directory packets before descending past the depth budget', () => {
  withPacketRoot('nimi-hardcut-limit-depth-', (root) => {
    fs.mkdirSync(path.join(root, 'deep', 'deeper', 'deepest'), { recursive: true });
    assert.throws(
      () => new PacketArtifactStore(root, {
        ...RESOURCE_POLICY,
        max_directory_depth: 2,
      }, PRIVACY_POLICY),
      (error) => {
        assert.equal(error.code, 'PACKET_DIRECTORY_DEPTH_EXCEEDED');
        assert.doesNotMatch(error.message, /deeper|deepest/u);
        return true;
      },
    );
  });
});

test('rejects one packet file over its byte limit before opening content', () => {
  withPacketRoot('nimi-hardcut-limit-file-', (root) => {
    fs.writeFileSync(path.join(root, 'oversized.bin'), Buffer.alloc(1025));
    assert.throws(
      () => new PacketArtifactStore(root, {
        ...RESOURCE_POLICY,
        max_single_file_bytes: 1024,
        max_packet_total_bytes: 4096,
      }, PRIVACY_POLICY),
      (error) => error.code === 'PACKET_FILE_TOO_LARGE',
    );
  });
});

test('rejects aggregate packet bytes during stat-only inventory', () => {
  withPacketRoot('nimi-hardcut-limit-total-', (root) => {
    fs.writeFileSync(path.join(root, 'one.bin'), Buffer.alloc(700));
    fs.writeFileSync(path.join(root, 'two.bin'), Buffer.alloc(700));
    assert.throws(
      () => new PacketArtifactStore(root, {
        ...RESOURCE_POLICY,
        max_single_file_bytes: 800,
        max_packet_total_bytes: 1024,
      }, PRIVACY_POLICY),
      (error) => error.code === 'PACKET_TOTAL_TOO_LARGE',
    );
  });
});

test('rejects oversized recognized text during stat-only inventory', () => {
  withPacketRoot('nimi-hardcut-limit-text-', (root) => {
    fs.writeFileSync(path.join(root, 'oversized.txt'), Buffer.alloc(513, 0x61));
    assert.throws(
      () => new PacketArtifactStore(root, {
        ...RESOURCE_POLICY,
        max_single_file_bytes: 1024,
        max_packet_total_bytes: 4096,
        max_text_scan_bytes: 512,
      }, PRIVACY_POLICY),
      (error) => error.code === 'TEXT_SCAN_TOO_LARGE',
    );
  });
});

test('applies a separate compressed-screenshot read limit', () => {
  withPacketRoot('nimi-hardcut-limit-shot-', (root) => {
    fs.writeFileSync(path.join(root, 'screenshot.png'), Buffer.alloc(513));
    const store = new PacketArtifactStore(root, {
      ...RESOURCE_POLICY,
      max_single_file_bytes: 1024,
      max_packet_total_bytes: 4096,
      max_screenshot_compressed_bytes: 512,
    }, PRIVACY_POLICY);
    assert.throws(
      () => store.read('screenshot.png', null, {
        maxBytes: 512,
        limitCode: 'SCREENSHOT_COMPRESSED_TOO_LARGE',
      }),
      (error) => error.code === 'SCREENSHOT_COMPRESSED_TOO_LARGE',
    );
  });
});

test('streams and forgets unreferenced packet bytes after privacy scan', () => {
  withPacketRoot('nimi-hardcut-stream-unreferenced-', (root) => {
    fs.writeFileSync(path.join(root, 'unreferenced.bin'), Buffer.alloc(1024, 0x7f));
    const store = new PacketArtifactStore(
      root,
      { ...RESOURCE_POLICY, max_packet_total_bytes: 4096 },
      PRIVACY_POLICY,
    );
    let scannedBytes = 0;
    store.scanAll(() => ({
      write(chunk) {
        scannedBytes += chunk.length;
      },
      end() {},
    }));
    assert.equal(scannedBytes, 1024);
    assert.throws(
      () => store.read('unreferenced.bin'),
      (error) => error.code === 'ARTIFACT_NOT_RETAINED',
    );
  });
});
