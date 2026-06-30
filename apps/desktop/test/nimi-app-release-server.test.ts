import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Nimi App release fixture server serves real artifact bytes with sha256 metadata', async () => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-release-server-'));
  try {
    const artifactPath = path.join(tmpRoot, 'fixture.tar');
    const bytes = Buffer.from('fixture app artifact bytes\n', 'utf8');
    writeFileSync(artifactPath, bytes);
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
    const { startNimiAppReleaseFixtureServer } = await import('../e2e/fixtures/nimi-app-release-server.mjs') as {
      startNimiAppReleaseFixtureServer: (input: { artifactPath: string }) => Promise<{
        origin: string;
        artifactUrl: string;
        metadataUrl: string;
        close: () => Promise<void>;
      }>;
    };

    const server = await startNimiAppReleaseFixtureServer({ artifactPath });
    try {
      assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(server.artifactUrl, `${server.origin}/releases/nimi-app-platform-fixture.tar`);
      assert.equal(server.metadataUrl, `${server.origin}/releases/nimi-app-platform-fixture.metadata.json`);

      const artifactResponse = await fetch(server.artifactUrl);
      assert.equal(artifactResponse.ok, true);
      assert.deepEqual(Buffer.from(await artifactResponse.arrayBuffer()), bytes);

      const metadataResponse = await fetch(server.metadataUrl);
      assert.equal(metadataResponse.ok, true);
      assert.deepEqual(await metadataResponse.json(), {
        artifactUrl: server.artifactUrl,
        sha256: expectedSha256,
        sizeBytes: bytes.byteLength,
      });
    } finally {
      await server.close();
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
