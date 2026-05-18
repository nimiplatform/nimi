import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NimiAppRegistryTransportError,
  createNimiAppRegistryTransport,
} from '../src/app/index.js';
import type { NimiAppRegistrySourceRow } from '../src/app/index.js';

const rows: readonly NimiAppRegistrySourceRow[] = [
  {
    appId: 'nimi.avatar',
    displayName: 'Avatar',
    publisher: 'nimi-first-party',
    trustTier: 'nimi-first-party',
    sourceRule: 'P-NAPP-011',
    admissionStatus: 'gated_by_avatar_master_gate',
    detail: 'Avatar master gate remains open',
  },
  {
    appId: 'nimi.parentos',
    displayName: 'ParentOS',
    publisher: 'nimi-first-party',
    trustTier: 'nimi-first-party',
    sourceRule: 'P-NAPP-011',
    admissionStatus: 'admitted',
  },
];

describe('Nimi App registry transport', () => {
  it('projects source registry rows into canonical SDK rows', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows });
    const registryRows = await transport.listRegistry();
    assert.equal(registryRows.length, 2);
    assert.equal(registryRows[0]!.appKind, 'nimi-app');
    assert.equal(registryRows[0]!.displayName, 'Avatar');
  });

  it('maps Avatar master gate to blocked launch readiness', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows });
    const status = await transport.getAppStatus('nimi.avatar');
    assert.equal(status.launchReadiness, 'blocked-by-master-gate');
    assert.match(status.detail ?? '', /master gate/);
  });

  it('maps admitted app to install-required by default without claiming readiness', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows });
    const status = await transport.getAppStatus('nimi.parentos');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('allows host-owned status resolver to override launch status', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => rows,
      resolveStatus: (row) => ({ appId: row.appId, launchReadiness: 'ready', installedVersion: 'dev' }),
    });
    const status = await transport.getAppStatus('nimi.parentos');
    assert.equal(status.launchReadiness, 'ready');
    assert.equal(status.installedVersion, 'dev');
  });

  it('fails closed when app row is absent', async () => {
    const transport = createNimiAppRegistryTransport({ loadRows: () => rows });
    await assert.rejects(transport.getAppStatus('missing.app'), NimiAppRegistryTransportError);
  });

  it('fails closed when registry source is not an array', async () => {
    const transport = createNimiAppRegistryTransport({
      loadRows: () => 'not-an-array' as unknown as readonly NimiAppRegistrySourceRow[],
    });
    await assert.rejects(transport.listRegistry(), NimiAppRegistryTransportError);
  });
});
