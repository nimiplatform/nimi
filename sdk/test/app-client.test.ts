import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NimiAppClient, NimiAppClientError } from '../src/app/index.js';
import type {
  NimiAppHealthRepairAction,
  NimiAppLifecycleEvent,
  NimiAppLaunchScopeRef,
  NimiAppOperationResult,
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
  NimiAppSubscription,
} from '../src/app/index.js';

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
        appId: 'avatar',
        appKind: 'nimi-app',
        displayName: 'Avatar',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        releaseDescriptorRef: 'avatar.bundled',
        installStoragePolicyRef: 'nimi-data-app-roots',
        sourceRule: 'P-NAPP-004',
      },
      {
        appId: 'parentos',
        appKind: 'nimi-app',
        displayName: 'ParentOS',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        releaseDescriptorRef: 'parentos.bundled',
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

  async install(appId: string): Promise<NimiAppOperationResult> {
    return { appId, operation: 'install', state: 'unsupported', reason: 'install-gateway-not-connected' };
  }

  async update(appId: string): Promise<NimiAppOperationResult> {
    return { appId, operation: 'update', state: 'unsupported', reason: 'not-connected' };
  }

  async uninstall(appId: string): Promise<NimiAppOperationResult> {
    return { appId, operation: 'uninstall', state: 'unsupported', reason: 'not-connected' };
  }

  async launch(appId: string, _scopeRef: NimiAppLaunchScopeRef): Promise<NimiAppOperationResult> {
    return { appId, operation: 'launch', state: 'unsupported', reason: 'runtime-mediated-launch-not-connected' };
  }

  subscribe(_callback: (event: NimiAppLifecycleEvent) => void): NimiAppSubscription {
    return { subscribed: false, reason: 'not-connected', unsubscribe: () => {} };
  }

  async healthRepair(appId: string, _action: NimiAppHealthRepairAction): Promise<NimiAppOperationResult> {
    return { appId, operation: 'health-repair', state: 'unsupported', reason: 'not-connected' };
  }
}

describe('NimiAppClient', () => {
  it('rejects null transport', () => {
    assert.throws(() => new NimiAppClient(null as unknown as NimiAppTransport), NimiAppClientError);
  });

  it('list returns admitted rows', async () => {
    const client = new NimiAppClient(new StubTransport());
    const rows = await client.list();
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.appId, 'avatar');
    assert.equal(rows[1]!.appId, 'parentos');
  });

  it('list rejects rows with non-admitted appKind (no public mod/extension)', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: 'rogue-mod',
        appKind: 'public-mod' as 'nimi-app',
        displayName: 'Rogue Mod',
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
      assert.equal((err as NimiAppClientError).code, 'public-mod-or-extension-admission');
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
    const status = await client.status('avatar');
    assert.equal(status.appId, 'avatar');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('status rejects non-canonical launchReadiness', async () => {
    const bad: NimiAppStatus = {
      appId: 'avatar',
      launchReadiness: 'best-effort-ready' as 'ready',
    };
    const client = new NimiAppClient(new StubTransport({ status: bad }));
    await assert.rejects(client.status('avatar'), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('status blocked-by-master-gate is a canonical readiness state', async () => {
    const bad: NimiAppStatus = {
      appId: 'avatar',
      launchReadiness: 'blocked-by-master-gate',
      detail: 'avatar master gate not yet true-closed',
    };
    const client = new NimiAppClient(new StubTransport({ status: bad }));
    const status = await client.status('avatar');
    assert.equal(status.launchReadiness, 'blocked-by-master-gate');
  });

  it('status wraps transport errors', async () => {
    const client = new NimiAppClient(new StubTransport({ status: new Error('boom') }));
    await assert.rejects(client.status('avatar'), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'transport-error');
      return true;
    });
  });

  it('status rejects null response', async () => {
    const client = new NimiAppClient(new StubTransport({ status: null }));
    await assert.rejects(client.status('avatar'), NimiAppClientError);
  });

  it('exposes install as typed fail-closed projection', async () => {
    const client = new NimiAppClient(new StubTransport());
    const result = await client.install('parentos');
    assert.equal(result.state, 'unsupported');
    assert.equal(result.reason, 'install-gateway-not-connected');
  });

  it('requires explicit launch scope', async () => {
    const client = new NimiAppClient(new StubTransport());
    await assert.rejects(client.launch('parentos', null as unknown as NimiAppLaunchScopeRef), NimiAppClientError);
  });
});
