import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NimiAppClient,
  createNimiAppRegistryTransport,
  type NimiAppStatus,
} from '@nimiplatform/sdk/app';
import {
  loadPlatformNimiAppRegistryRows,
} from '../src/runtime/platform-catalog/index.js';
import { projectDiscovery } from '../src/shell/renderer/first-run/discovery-projection.js';
import { projectLibrary } from '../src/shell/renderer/first-run/library-projection.js';

function createPlatformRegistryClient(resolveStatus?: (appId: string) => NimiAppStatus): NimiAppClient {
  return new NimiAppClient(createNimiAppRegistryTransport({
    loadRows: loadPlatformNimiAppRegistryRows,
    resolveStatus: resolveStatus
      ? (row) => resolveStatus(row.appId)
      : undefined,
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

  it('keeps Avatar blocked by master gate and out of installable Discovery', async () => {
    const client = createPlatformRegistryClient();
    const library = await projectLibrary(client);
    const discovery = await projectDiscovery(client);
    assert.equal(library.status, 'loaded');
    assert.equal(discovery.status, 'loaded');
    if (library.status !== 'loaded' || discovery.status !== 'loaded') return;

    const avatar = library.entries.find((entry) => entry.app.appId === 'nimi.avatar');
    assert.ok(avatar, 'Avatar registry row must be projected');
    assert.equal(avatar.status?.launchReadiness, 'blocked-by-master-gate');
    assert.equal(
      discovery.entries.some((entry) => entry.app.appId === 'nimi.avatar'),
      false,
      'Avatar must not appear in installable Discovery while master gate is open',
    );
  });

  it('fails closed when a registry status row is missing', async () => {
    await assert.rejects(
      createPlatformRegistryClient().getAppStatus('missing.registry.row'),
      /missing registry row|getAppStatus transport error/i,
    );
  });

  it('surfaces permission-required launch posture without mapping it to ready', async () => {
    const library = await projectLibrary(createPlatformRegistryClient((appId) => ({
      appId,
      launchReadiness: appId === 'nimi.parentos' ? 'permission-required' : 'blocked-by-master-gate',
      detail: appId === 'nimi.parentos' ? 'grant unavailable' : 'Avatar master gate remains open',
    })));
    assert.equal(library.status, 'loaded');
    if (library.status !== 'loaded') return;

    const parentOS = library.entries.find((entry) => entry.app.appId === 'nimi.parentos');
    assert.ok(parentOS, 'ParentOS registry row must be projected');
    assert.equal(parentOS.status?.launchReadiness, 'permission-required');
    assert.notEqual(parentOS.status?.launchReadiness, 'ready');
    assert.match(parentOS.status?.detail ?? '', /grant unavailable/);
  });
});
