import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NimiAppClient, NimiAppInventoryEntry } from '@nimiplatform/sdk/app';
import { projectAppsPanel } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import { inventoryEntry, localRecord } from './apps-read-only-fixtures.js';

function clientFor(
  list: () => Promise<readonly NimiAppInventoryEntry[]>,
  status?: () => never,
): NimiAppClient {
  return {
    list,
    get: async () => { throw new Error('get must not be called'); },
    status: async () => {
      status?.();
      throw new Error('status must not be called');
    },
  } as unknown as NimiAppClient;
}

describe('Desktop Apps unified read-only projection', () => {
  it('uses list() as the only renderer projection and preserves ordinary catalog proof', async () => {
    let statusCalls = 0;
    const projection = await projectAppsPanel(clientFor(
      async () => [inventoryEntry()],
      () => { statusCalls += 1; throw new Error('unexpected'); },
    ));
    assert.equal(statusCalls, 0);
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries.length, 1);
    const [entry] = projection.entries;
    assert.equal(entry?.cardState.inventory, 'catalog_only');
    assert.equal(entry?.cardState.access, 'package_unavailable');
    assert.equal(entry?.cardState.immutablePackage, 'immutable_package_unavailable');
    assert.deepEqual(entry?.catalogDiscoveryProof, {
      admittedCatalogDiscovery: true,
      ordinaryVisibility: 'ordinary-visible',
      required: {
        catalog: 'present',
        ordinaryVisibility: 'ordinary-visible',
        localRecord: 'absent',
      },
      sources: {
        catalog: 'present',
        account: 'absent',
        localRecord: 'absent',
        packageReadiness: 'present',
      },
    });
  });

  it('keeps local-development record presence separate from catalog discovery', async () => {
    const entry = inventoryEntry({
      openReadiness: 'permission-required',
      installState: 'local-record-active',
      trustTier: 'local_development',
      sources: { localRecord: { status: 'present', value: localRecord('active', { grantPosture: 'zero-grant' }) } },
    });
    const projection = await projectAppsPanel(clientFor(async () => [entry]));
    assert.equal(projection.status, 'loaded');
    if (projection.status !== 'loaded') return;
    assert.equal(projection.entries[0]?.cardState.inventory, 'local_record_active');
    assert.equal(projection.entries[0]?.cardState.access, 'permission_required');
    assert.equal(projection.entries[0]?.catalogDiscoveryProof.admittedCatalogDiscovery, false);
  });

  it('surfaces the exact list failure without fabricating cards', async () => {
    const projection = await projectAppsPanel(clientFor(async () => {
      throw new Error('fixed Runtime service unavailable');
    }));
    assert.deepEqual(projection, {
      status: 'error',
      detail: 'list failed: fixed Runtime service unavailable',
    });
  });
});
