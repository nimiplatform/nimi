import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectDiscovery } from '../src/shell/renderer/first-run/discovery-projection.js';
import {
  NimiAppClient,
} from '@nimiplatform/sdk/app';
import type {
  NimiAppInventoryEntry,
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
} from '@nimiplatform/sdk/app';

function makeClient(behavior: {
  list?: readonly NimiAppInventoryEntry[] | Error;
  status?: (appId: string) => NimiAppStatus | Error;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list() {
      if (behavior.list instanceof Error) throw behavior.list;
      if (behavior.list !== undefined) return behavior.list;
      return [
        inventoryEntry(buildRow('example-app', 'Example App')),
      ];
    },
    async get(appId: string) {
      const rows = await this.list();
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) throw new Error('missing');
      return row;
    },
    async status(appId: string) {
      if (behavior.status) {
        const result = behavior.status(appId);
        if (result instanceof Error) throw result;
        return result;
      }
      if (appId === 'example-app') return { appId, launchReadiness: 'install-required' };
      return { appId, launchReadiness: 'update-required' };
    },
  };
  return new NimiAppClient(transport);
}

function buildRow(appId: string, displayName: string): NimiAppRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName,
    trustTier: 'nimi-first-party',
    publisher: 'Nimi',
    aiProfileSelectionRef: 'local-standard',
    capabilitySet: ['text.generate'],
    releaseDescriptorRef: `${appId}.bundled`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
  };
}

function inventoryEntry(row: NimiAppRow): NimiAppInventoryEntry {
  return {
    appId: row.appId,
    displayName: row.displayName,
    appKind: row.appKind,
    publisher: row.publisher,
    aiProfileSelectionRef: row.aiProfileSelectionRef,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    trustTier: row.trustTier,
    capabilitySet: [...row.capabilitySet],
    sources: {
      catalog: { status: 'present', value: row },
      account: { status: 'absent' },
      local: { status: 'absent' },
      packageReadiness: { status: 'absent' },
    },
    installState: 'not-installed',
    openReadiness: 'install-required',
    activeJobs: [],
    nextActions: ['install'],
  };
}

describe('projectDiscovery', () => {
  it('filters to apps that are install/update/repair required', async () => {
    const projection = await projectDiscovery(makeClient());
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      const ids = projection.entries.map((e) => e.app.appId);
      assert.deepEqual([...ids].sort(), ['example-app']);
    }
  });

  it('returns error projection when underlying Library errors', async () => {
    const projection = await projectDiscovery(makeClient({ list: new Error('list boom') }));
    assert.equal(projection.status, 'error');
  });

  it('returns empty loaded when no apps need install/update/repair', async () => {
    const projection = await projectDiscovery(makeClient({
      status: (id) => ({ appId: id, launchReadiness: 'ready' }),
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      assert.equal(projection.entries.length, 0);
    }
  });

  it('passes through blocked-by-master-gate as NOT installable (filtered out)', async () => {
    const projection = await projectDiscovery(makeClient({
      status: (id) => ({ appId: id, launchReadiness: 'blocked-by-master-gate' }),
    }));
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      assert.equal(projection.entries.length, 0);
    }
  });
});

const viewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/discovery-view.tsx'),
  'utf8',
);

test('DiscoveryView source renders error banner for projection.status === "error"', () => {
  assert.match(viewSource, /projection\.status === 'error'/);
  assert.match(viewSource, /data-testid="discovery-error"/);
});

test('DiscoveryView source renders empty placeholder when no installable apps', () => {
  assert.match(viewSource, /data-testid="discovery-empty"/);
});

test('DiscoveryView source labels Install/Update/Repair actions', () => {
  for (const action of ['Install', 'Update', 'Repair']) {
    assert.ok(viewSource.includes(action), `DiscoveryView missing action label "${action}"`);
  }
});

test('DiscoveryView source is pure presentational', () => {
  assert.doesNotMatch(viewSource, /\buseState\b/);
  assert.doesNotMatch(viewSource, /\buseEffect\b/);
});

test('DiscoveryView source has no provider/model identifier string constants', () => {
  const forbidden =
    /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
  const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let match: RegExpExecArray | null;
  stringLiteral.lastIndex = 0;
  while ((match = stringLiteral.exec(viewSource)) !== null) {
    const literal = match[2];
    if (literal && forbidden.test(literal)) {
      assert.fail(`forbidden identifier "${literal}" found in DiscoveryView`);
    }
  }
});
