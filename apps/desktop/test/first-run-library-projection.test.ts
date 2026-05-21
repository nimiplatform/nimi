import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectLibrary } from '../src/shell/renderer/first-run/library-projection.js';
import type {
  NimiAppClient,
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
} from '@nimiplatform/sdk/app';
import { NimiAppClient as NimiAppClientCtor } from '@nimiplatform/sdk/app';

function makeClient(behavior: {
  list?: readonly NimiAppRow[] | Error;
  status?: (appId: string) => NimiAppStatus | Error;
} = {}): NimiAppClient {
  const transport: NimiAppTransport = {
    async list() {
      if (behavior.list instanceof Error) throw behavior.list;
      if (behavior.list !== undefined) return behavior.list;
      return [
        buildRow('parentos', 'ParentOS'),
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
      return { appId, launchReadiness: 'install-required' };
    },
  };
  return new NimiAppClientCtor(transport);
}

function buildRow(appId: string, displayName: string): NimiAppRow {
  return {
    appId,
    appKind: 'nimi-app',
    displayName,
    trustTier: 'nimi-first-party',
    publisher: 'Nimi',
    releaseDescriptorRef: `${appId}.bundled`,
    installStoragePolicyRef: 'nimi-data-app-roots',
    sourceRule: 'P-NAPP-004',
  };
}

describe('projectLibrary', () => {
  it('returns loaded with one entry per registry row', async () => {
    const projection = await projectLibrary(makeClient());
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      assert.equal(projection.entries.length, 1);
      assert.equal(projection.entries[0]!.app.appId, 'parentos');
      assert.equal(projection.entries[0]!.status?.launchReadiness, 'install-required');
    }
  });

  it('returns error projection when list throws (no silent empty list)', async () => {
    const projection = await projectLibrary(makeClient({ list: new Error('reg boom') }));
    assert.equal(projection.status, 'error');
    if (projection.status === 'error') {
      assert.match(projection.detail, /reg boom|list failed|list transport error/);
    }
  });

  it('captures per-app status errors per entry, does not collapse the projection', async () => {
    const client = makeClient({
      list: [
        buildRow('avatar', 'Avatar'),
        buildRow('parentos', 'ParentOS'),
      ],
      status: (id) => (id === 'parentos' ? new Error('status boom') : { appId: id, launchReadiness: 'ready' as const }),
    });
    const projection = await projectLibrary(client);
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      assert.equal(projection.entries.length, 2);
      assert.equal(projection.entries[0]!.status?.launchReadiness, 'ready');
      assert.equal(projection.entries[1]!.fetchError !== undefined, true);
    }
  });

  it('returns error projection on null client', async () => {
    const projection = await projectLibrary(null as unknown as NimiAppClient);
    assert.equal(projection.status, 'error');
  });

  it('flags entries whose launchReadiness is non-canonical', async () => {
    const client = makeClient({
      status: (id) => ({ appId: id, launchReadiness: 'best-effort-ready' as 'ready' }),
    });
    const projection = await projectLibrary(client);
    assert.equal(projection.status, 'loaded');
    if (projection.status === 'loaded') {
      assert.ok(projection.entries[0]!.fetchError);
      assert.match(projection.entries[0]!.fetchError ?? '', /not canonical|non-canonical/);
    }
  });

  it('library projection module embeds no provider/model identifier string constants', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(import.meta.dirname, '../src/shell/renderer/first-run/library-projection.ts'),
      'utf8',
    );
    const forbidden =
      /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
    const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
    let match: RegExpExecArray | null;
    stringLiteral.lastIndex = 0;
    while ((match = stringLiteral.exec(source)) !== null) {
      const literal = match[2];
      if (literal && forbidden.test(literal)) {
        assert.fail(`forbidden identifier "${literal}" found in library-projection.ts`);
      }
    }
  });
});
