import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { createSha256Hasher, sha256Hex } from './sha256.js';

test('incremental SHA256 preserves canonical hashes across padding and chunk boundaries', () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1024, 1048583]) {
    const bytes = randomBytes(size);
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256Hex(bytes), expected);
    for (const chunk of [1, 17, 63, 64, 65, 4096]) {
      const hash = createSha256Hasher();
      for (let offset = 0; offset < bytes.length; offset += chunk) hash.update(bytes.subarray(offset, offset + chunk));
      assert.equal(hash.hex(), expected);
      assert.throws(() => hash.update(bytes));
    }
  }
});
