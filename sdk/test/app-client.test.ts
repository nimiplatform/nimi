import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NimiAppClient, NimiAppClientError } from '../src/app/index.js';
import type {
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
} from '../src/app/index.js';

// T4 Fork B: NimiAppClient is a pure read-projection surface — list / get /
// status only. Lifecycle mutation is owned by `runtime.appLifecycle`; the
// transport carries no mutation methods.
class StubTransport implements NimiAppTransport {
  constructor(
    private readonly behavior: {
      readonly list?: readonly NimiAppRow[] | Error;
      readonly status?: NimiAppStatus | Error | null;
    } = {},
  ) {}

  async list(): Promise<readonly NimiAppRow[]> {
    if (this.behavior.list instanceof Error) throw this.behavior.list;
    if (this.behavior.list !== undefined) return this.behavior.list;
    return [
      {
        appId: 'nimi.example-app',
        appKind: 'nimi-app',
        displayName: 'Example App',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        releaseDescriptorRef: 'nimi.example-app.bundled',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
      },
    ];
  }

  async get(appId: string): Promise<NimiAppRow> {
    const rows = await this.list();
    const row = rows.find((candidate) => candidate.appId === appId);
    if (!row) throw new Error('missing');
    return row;
  }

  async status(appId: string): Promise<NimiAppStatus> {
    if (this.behavior.status instanceof Error) throw this.behavior.status;
    if (this.behavior.status === null) return null as unknown as NimiAppStatus;
    if (this.behavior.status !== undefined) return this.behavior.status;
    return {
      appId,
      launchReadiness: 'install-required',
      detail: 'app not yet installed',
    };
  }

}

describe('NimiAppClient', () => {
  it('rejects null transport', () => {
    assert.throws(() => new NimiAppClient(null as unknown as NimiAppTransport), NimiAppClientError);
  });

  it('list returns admitted rows', async () => {
    const client = new NimiAppClient(new StubTransport());
    const rows = await client.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.appId, 'nimi.example-app');
  });

  it('list rejects rows with non-admitted appKind', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: 'rogue-kind',
        appKind: 'external-app' as 'nimi-app',
        displayName: 'Rogue App',
        trustTier: 'nimi-community',
        publisher: 'Third Party',
        releaseDescriptorRef: 'rogue.bundled',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
      },
    ];
    const client = new NimiAppClient(new StubTransport({ list: bad }));
    await assert.rejects(client.list(), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'non-canonical-app-kind');
      return true;
    });
  });

  it('list rejects rows with non-canonical trust tier', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: 'rogue',
        appKind: 'nimi-app',
        displayName: 'Rogue',
        trustTier: 'nimi-elevated-secret' as 'nimi-first-party',
        publisher: 'Third Party',
        releaseDescriptorRef: 'rogue.bundled',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
      },
    ];
    const client = new NimiAppClient(new StubTransport({ list: bad }));
    await assert.rejects(client.list(), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('list rejects rows missing required fields', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: '',
        appKind: 'nimi-app',
        displayName: 'X',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        releaseDescriptorRef: 'x.bundled',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
      },
    ];
    const client = new NimiAppClient(new StubTransport({ list: bad }));
    await assert.rejects(client.list(), NimiAppClientError);
  });

  it('list wraps transport errors', async () => {
    const client = new NimiAppClient(new StubTransport({ list: new Error('boom') }));
    await assert.rejects(client.list(), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'transport-error');
      return true;
    });
  });

  it('list rejects non-array response', async () => {
    const client = new NimiAppClient(new StubTransport({ list: 'not-an-array' as unknown as NimiAppRow[] }));
    await assert.rejects(client.list(), NimiAppClientError);
  });

  it('status rejects missing appId', async () => {
    const client = new NimiAppClient(new StubTransport());
    await assert.rejects(client.status(''), NimiAppClientError);
  });

  it('status returns canonical launchReadiness', async () => {
    const client = new NimiAppClient(new StubTransport());
    const status = await client.status('nimi.example-app');
    assert.equal(status.appId, 'nimi.example-app');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('status rejects non-canonical launchReadiness', async () => {
    const bad: NimiAppStatus = {
      appId: 'nimi.example-app',
      launchReadiness: 'best-effort-ready' as 'ready',
    };
    const client = new NimiAppClient(new StubTransport({ status: bad }));
    await assert.rejects(client.status('nimi.example-app'), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('status blocked-by-master-gate is a canonical readiness state', async () => {
    const bad: NimiAppStatus = {
      appId: 'gated-internal-app',
      launchReadiness: 'blocked-by-master-gate',
      detail: 'master gate not yet true-closed',
    };
    const client = new NimiAppClient(new StubTransport({ status: bad }));
    const status = await client.status('gated-internal-app');
    assert.equal(status.launchReadiness, 'blocked-by-master-gate');
  });

  it('status wraps transport errors', async () => {
    const client = new NimiAppClient(new StubTransport({ status: new Error('boom') }));
    await assert.rejects(client.status('nimi.example-app'), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'transport-error');
      return true;
    });
  });

  it('status rejects null response', async () => {
    const client = new NimiAppClient(new StubTransport({ status: null }));
    await assert.rejects(client.status('nimi.example-app'), NimiAppClientError);
  });

  it('is a pure read-projection surface — no lifecycle mutation methods', () => {
    const client = new NimiAppClient(new StubTransport()) as unknown as Record<string, unknown>;
    // T4 Fork B: install / update / uninstall / launch / healthRepair /
    // subscribe are retired from NimiAppClient. Lifecycle mutation is owned
    // by the runtime-mediated `runtime.appLifecycle` surface.
    for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
      assert.equal(
        typeof client[retired],
        'undefined',
        `NimiAppClient must not expose the retired "${retired}" stub`,
      );
    }
  });
});
