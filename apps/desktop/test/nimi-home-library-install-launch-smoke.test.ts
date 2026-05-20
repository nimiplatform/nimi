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
  it('projects ParentOS source-development posture as install-required, not ready', async () => {
    const library = await projectLibrary(createPlatformRegistryClient());
    assert.equal(library.status, 'loaded');
    if (library.status !== 'loaded') return;

    const parentOS = library.entries.find((entry) => entry.app.appId === 'nimi.parentos');
    assert.ok(parentOS, 'ParentOS registry row must be projected');
    assert.equal(parentOS.status?.launchReadiness, 'install-required');
    assert.notEqual(parentOS.status?.launchReadiness, 'ready');
  });

  it('keeps hidden and developer-only Apps out of ordinary Library and installable Discovery', async () => {
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
    const tester = library.entries.find((entry) => entry.app.appId === 'nimi.tester');
    assert.equal(tester, undefined, 'Tester must not be projected in ordinary Library');
    assert.equal(
      discovery.entries.some((entry) => entry.app.appId === 'nimi.tester'),
      false,
      'Tester must not appear in installable Discovery while developer-only',
    );
  });

  it('fails closed when a registry status row is missing', async () => {
    await assert.rejects(
      createPlatformRegistryClient().status('missing.registry.row'),
      /missing registry row|status transport error/i,
    );
  });

  it('install operation does not claim success without the runtime install gateway', async () => {
    const result = await createPlatformRegistryClient().install('nimi.parentos');
    assert.equal(result.state, 'unsupported');
    assert.equal(result.reason, 'install-gateway-not-connected');
  });

  it('status cannot be promoted to ready without digest-verified install evidence', async () => {
    const library = await projectLibrary(createPlatformRegistryClient());
    assert.equal(library.status, 'loaded');
    if (library.status !== 'loaded') return;

    const parentOS = library.entries.find((entry) => entry.app.appId === 'nimi.parentos');
    assert.ok(parentOS, 'ParentOS registry row must be projected');
    assert.equal(parentOS.status?.verificationState, 'not-installed');
    assert.notEqual(parentOS.status?.launchReadiness, 'ready');
  });
});
