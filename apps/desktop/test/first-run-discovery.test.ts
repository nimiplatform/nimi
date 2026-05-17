import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectDiscovery } from '../src/shell/renderer/first-run/discovery-projection.js';
import {
  NimiAppClient,
} from '@nimiplatform/sdk/app';
import type {
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
} from '@nimiplatform/sdk/app';

function makeClient(behavior: {
  list?: readonly NimiAppRow[] | Error;
  status?: (appId: string) => NimiAppStatus | Error;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async listRegistry() {
      if (behavior.list instanceof Error) throw behavior.list;
      if (behavior.list !== undefined) return behavior.list;
      return [
        { appId: 'avatar', appKind: 'nimi-app', displayName: 'Avatar', trustTier: 'nimi-first-party', publisher: 'Nimi', sourceRule: 'P-NAPP-004' },
        { appId: 'parentos', appKind: 'nimi-app', displayName: 'ParentOS', trustTier: 'nimi-first-party', publisher: 'Nimi', sourceRule: 'P-NAPP-004' },
        { appId: 'forge', appKind: 'nimi-app', displayName: 'Forge', trustTier: 'nimi-first-party', publisher: 'Nimi', sourceRule: 'P-NAPP-004' },
      ];
    },
    async getAppStatus(appId: string) {
      if (behavior.status) {
        const result = behavior.status(appId);
        if (result instanceof Error) throw result;
        return result;
      }
      if (appId === 'avatar') return { appId, launchReadiness: 'ready' };
      if (appId === 'parentos') return { appId, launchReadiness: 'install-required' };
      return { appId, launchReadiness: 'update-required' };
    },
  };
  return new NimiAppClient(transport);
}

describe('projectDiscovery', () => {
  it('filters to apps that are install/update/repair required', async () => {
    const projection = await projectDiscovery(makeClient());
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      // avatar=ready filtered out; parentos=install-required + forge=update-required kept
      const ids = projection.entries.map((e) => e.app.appId);
      assert.deepEqual([...ids].sort(), ['forge', 'parentos']);
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
