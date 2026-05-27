import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NimiAppClient,
  createNimiAppRegistryTransport,
} from '@nimiplatform/sdk/app';
// T4 Fork C: the live Apps bridge no longer reads `platform-catalog/index.ts`
// for the Nimi App registry — it reads the runtime `~/.nimi/apps` projections.
// This smoke test still exercises the SDK transport against the generated
// catalog projection used purely as a row fixture.
import {
  loadPlatformNimiAppReleaseDescriptorRows,
  loadPlatformNimiAppRegistryRows,
} from '../src/runtime/platform-catalog/generated.js';
import { projectDiscovery } from '../src/shell/renderer/first-run/discovery-projection.js';
import { projectLibrary } from '../src/shell/renderer/first-run/library-projection.js';

function createPlatformRegistryClient(): NimiAppClient {
  return new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadPlatformNimiAppRegistryRows,
    loadReleaseDescriptors: loadPlatformNimiAppReleaseDescriptorRows,
  }));
}

describe('Nimi Home Library / install / launch smoke', () => {
  it('projects no ordinary Library entries when no ordinary app is admitted', async () => {
    const library = await projectLibrary(createPlatformRegistryClient());
    assert.equal(library.status, 'loaded');
    if (library.status !== 'loaded') return;

    assert.deepEqual(library.entries.map((entry) => entry.app.appId), []);
  });

  it('keeps hidden Apps out of ordinary Library and installable Discovery', async () => {
    const client = createPlatformRegistryClient();
    const library = await projectLibrary(client);
    const discovery = await projectDiscovery(client);
    assert.equal(library.status, 'loaded');
    assert.equal(discovery.status, 'loaded');
    if (library.status !== 'loaded' || discovery.status !== 'loaded') return;

    const avatar = library.entries.find((entry) => entry.app.appId === 'nimi.avatar');
    assert.equal(avatar, undefined, 'Avatar must not be projected in ordinary Library');
    assert.equal(
      discovery.entries.some((entry) => entry.app.appId === 'nimi.avatar'),
      false,
      'Avatar must not appear in installable Discovery while master gate is open',
    );
  });

  it('fails closed when a registry status row is missing', async () => {
    await assert.rejects(
      createPlatformRegistryClient().status('missing.registry.row'),
      /missing registry row|status transport error/i,
    );
  });

  it('registry client is read-projection only — install/launch are runtime.appLifecycle-owned', () => {
    // T4 Fork B: the NimiAppClient install/launch stubs are retired. The Apps
    // lifecycle (install / open / update / uninstall) is owned solely by the
    // runtime-mediated `runtime.appLifecycle` surface, never the registry
    // client.
    const client = createPlatformRegistryClient() as unknown as Record<string, unknown>;
    for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
      assert.equal(
        typeof client[retired],
        'undefined',
        `registry client must not expose the retired "${retired}" stub`,
      );
    }
  });

  it('empty ordinary catalog cannot synthesize a ready app without registry evidence', async () => {
    const library = await projectLibrary(createPlatformRegistryClient());
    assert.equal(library.status, 'loaded');
    if (library.status !== 'loaded') return;

    assert.equal(library.entries.some((entry) => entry.status?.launchReadiness === 'ready'), false);
  });
});
