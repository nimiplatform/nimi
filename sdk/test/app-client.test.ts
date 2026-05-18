import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NimiAppClient, NimiAppClientError } from '../src/app/index.js';
import type { NimiAppRow, NimiAppStatus, NimiAppTransport } from '../src/app/index.js';

class StubTransport implements NimiAppTransport {
  constructor(
    private readonly behavior: {
      readonly listRegistry?: readonly NimiAppRow[] | Error;
      readonly getAppStatus?: NimiAppStatus | Error | null;
    } = {},
  ) {}

  async listRegistry(): Promise<readonly NimiAppRow[]> {
    if (this.behavior.listRegistry instanceof Error) throw this.behavior.listRegistry;
    if (this.behavior.listRegistry !== undefined) return this.behavior.listRegistry;
    return [
      {
        appId: 'avatar',
        appKind: 'nimi-app',
        displayName: 'Avatar',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        sourceRule: 'P-NAPP-004',
      },
      {
        appId: 'parentos',
        appKind: 'nimi-app',
        displayName: 'ParentOS',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        sourceRule: 'P-NAPP-004',
      },
    ];
  }

  async getAppStatus(appId: string): Promise<NimiAppStatus> {
    if (this.behavior.getAppStatus instanceof Error) throw this.behavior.getAppStatus;
    if (this.behavior.getAppStatus === null) return null as unknown as NimiAppStatus;
    if (this.behavior.getAppStatus !== undefined) return this.behavior.getAppStatus;
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

  it('listRegistry returns admitted rows', async () => {
    const client = new NimiAppClient(new StubTransport());
    const rows = await client.listRegistry();
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.appId, 'avatar');
    assert.equal(rows[1]!.appId, 'parentos');
  });

  it('listRegistry rejects rows with non-admitted appKind (no public mod/extension)', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: 'rogue-mod',
        appKind: 'public-mod' as 'nimi-app',
        displayName: 'Rogue Mod',
        trustTier: 'nimi-community',
        publisher: 'Third Party',
        sourceRule: 'P-NAPP-004',
      },
    ];
    const client = new NimiAppClient(new StubTransport({ listRegistry: bad }));
    await assert.rejects(client.listRegistry(), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'public-mod-or-extension-admission');
      return true;
    });
  });

  it('listRegistry rejects rows with non-canonical trust tier', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: 'rogue',
        appKind: 'nimi-app',
        displayName: 'Rogue',
        trustTier: 'nimi-elevated-secret' as 'nimi-first-party',
        publisher: 'Third Party',
        sourceRule: 'P-NAPP-004',
      },
    ];
    const client = new NimiAppClient(new StubTransport({ listRegistry: bad }));
    await assert.rejects(client.listRegistry(), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('listRegistry rejects rows missing required fields', async () => {
    const bad: NimiAppRow[] = [
      {
        appId: '',
        appKind: 'nimi-app',
        displayName: 'X',
        trustTier: 'nimi-first-party',
        publisher: 'Nimi',
        sourceRule: 'P-NAPP-004',
      },
    ];
    const client = new NimiAppClient(new StubTransport({ listRegistry: bad }));
    await assert.rejects(client.listRegistry(), NimiAppClientError);
  });

  it('listRegistry wraps transport errors', async () => {
    const client = new NimiAppClient(new StubTransport({ listRegistry: new Error('boom') }));
    await assert.rejects(client.listRegistry(), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'transport-error');
      return true;
    });
  });

  it('listRegistry rejects non-array response', async () => {
    const client = new NimiAppClient(new StubTransport({ listRegistry: 'not-an-array' as unknown as NimiAppRow[] }));
    await assert.rejects(client.listRegistry(), NimiAppClientError);
  });

  it('getAppStatus rejects missing appId', async () => {
    const client = new NimiAppClient(new StubTransport());
    await assert.rejects(client.getAppStatus(''), NimiAppClientError);
  });

  it('getAppStatus returns canonical launchReadiness', async () => {
    const client = new NimiAppClient(new StubTransport());
    const status = await client.getAppStatus('avatar');
    assert.equal(status.appId, 'avatar');
    assert.equal(status.launchReadiness, 'install-required');
  });

  it('getAppStatus rejects non-canonical launchReadiness', async () => {
    const bad: NimiAppStatus = {
      appId: 'avatar',
      launchReadiness: 'best-effort-ready' as 'ready',
    };
    const client = new NimiAppClient(new StubTransport({ getAppStatus: bad }));
    await assert.rejects(client.getAppStatus('avatar'), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('getAppStatus blocked-by-master-gate is a canonical readiness state', async () => {
    const bad: NimiAppStatus = {
      appId: 'avatar',
      launchReadiness: 'blocked-by-master-gate',
      detail: 'avatar master gate not yet true-closed',
    };
    const client = new NimiAppClient(new StubTransport({ getAppStatus: bad }));
    const status = await client.getAppStatus('avatar');
    assert.equal(status.launchReadiness, 'blocked-by-master-gate');
  });

  it('getAppStatus wraps transport errors', async () => {
    const client = new NimiAppClient(new StubTransport({ getAppStatus: new Error('boom') }));
    await assert.rejects(client.getAppStatus('avatar'), (err: unknown) => {
      assert.ok(err instanceof NimiAppClientError);
      assert.equal((err as NimiAppClientError).code, 'transport-error');
      return true;
    });
  });

  it('getAppStatus rejects null response', async () => {
    const client = new NimiAppClient(new StubTransport({ getAppStatus: null }));
    await assert.rejects(client.getAppStatus('avatar'), NimiAppClientError);
  });
});
