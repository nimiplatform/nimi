import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppAssetsClient } from './local-app-runtime-platform-assets.js';

test('return before the first asset chunk closes the upstream once without reading bytes', async () => {
  let closed = 0; let reads = 0;
  const unexpected = async (): Promise<never> => { throw new Error('unexpected asset operation'); };
  const client = createNimiLocalAppAssetsClient({ stat: unexpected, list: unexpected, write: unexpected, remove: unexpected,
    move: unexpected, reveal: unexpected, adoptArtifact: unexpected,
    read: async () => ({
      asset: { relativePath: 'audio/source.wav', mediaType: 'audio/wav', sizeBytes: 4, sha256: 'sha256:' + 'a'.repeat(64), createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z' },
      range: { offset: 0, length: 4, totalSize: 4 },
      body: { [Symbol.asyncIterator]() { return {
        next: async () => { reads++; return { done: false as const, value: Uint8Array.of(1, 2, 3, 4) }; },
        return: async () => { closed++; return { done: true as const, value: undefined }; },
      }; } },
    }),
  });
  const result = await client.read({ relativePath: 'audio/source.wav' });
  const iterator = result.body[Symbol.asyncIterator]();
  await iterator.return?.(); await iterator.return?.();
  assert.equal(closed, 1); assert.equal(reads, 0);
  assert.equal((await iterator.next()).done, true);
  assert.throws(() => result.body[Symbol.asyncIterator](), /already consumed/);
});
