import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionClient, PermissionClientError } from '../src/scope/permission/index.js';
import type {
  GrantRequestAccepted,
  GrantSpec,
  GrantStatus,
  PermissionGrantEvent,
  PermissionStatusSnapshot,
  PermissionTransport,
} from '../src/scope/permission/index.js';
import type { AIScopeRef } from '../src/scope/index.js';

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'tester.app', surfaceId: 'settings' };

const permissionScope = {
  appId: 'tester.app',
  scopeFamily: 'account' as const,
  scopeName: 'account.read',
};

function status(state: GrantStatus['state'] = 'granted', grantId = 'grant-1'): GrantStatus {
  return {
    scopeRef,
    grant: {
      grantId,
      permissionScope,
      subjectUserId: 'user-1',
    },
    state,
    issuedAt: '2026-05-17T00:00:00Z',
  };
}

class StubTransport implements PermissionTransport {
  readonly calls: string[] = [];

  constructor(
    private readonly behavior: {
      readonly list?: readonly GrantStatus[] | Error | null;
      readonly get?: GrantStatus | Error | null;
      readonly request?: GrantRequestAccepted | Error | null;
      readonly revoke?: GrantStatus | Error | null;
      readonly status?: PermissionStatusSnapshot | Error | null;
      readonly subscribe?: PermissionGrantEvent | Error | null;
    } = {},
  ) {}

  async list(inputScopeRef: AIScopeRef): Promise<readonly GrantStatus[]> {
    this.calls.push(`list:${inputScopeRef.ownerId}`);
    if (this.behavior.list instanceof Error) throw this.behavior.list;
    if (this.behavior.list === null) return null as unknown as GrantStatus[];
    return this.behavior.list ?? [status()];
  }

  async get(inputScopeRef: AIScopeRef, grantId: string): Promise<GrantStatus> {
    this.calls.push(`get:${inputScopeRef.ownerId}:${grantId}`);
    if (this.behavior.get instanceof Error) throw this.behavior.get;
    if (this.behavior.get === null) return null as unknown as GrantStatus;
    return this.behavior.get ?? status('granted', grantId);
  }

  async request(inputScopeRef: AIScopeRef, _grantSpec: GrantSpec): Promise<GrantRequestAccepted> {
    this.calls.push(`request:${inputScopeRef.ownerId}`);
    if (this.behavior.request instanceof Error) throw this.behavior.request;
    if (this.behavior.request === null) return null as unknown as GrantRequestAccepted;
    return this.behavior.request ?? { scopeRef: inputScopeRef, accepted: true, grantId: 'grant-1', state: 'pending' };
  }

  async revoke(inputScopeRef: AIScopeRef, grantId: string): Promise<GrantStatus> {
    this.calls.push(`revoke:${inputScopeRef.ownerId}:${grantId}`);
    if (this.behavior.revoke instanceof Error) throw this.behavior.revoke;
    if (this.behavior.revoke === null) return null as unknown as GrantStatus;
    return this.behavior.revoke ?? status('revoked', grantId);
  }

  subscribe(inputScopeRef: AIScopeRef, callback: (event: PermissionGrantEvent) => void): () => void {
    this.calls.push(`subscribe:${inputScopeRef.ownerId}`);
    if (this.behavior.subscribe instanceof Error) throw this.behavior.subscribe;
    if (this.behavior.subscribe !== null) {
      callback(this.behavior.subscribe ?? { scopeRef: inputScopeRef, grant: status('granted') });
    }
    return () => {
      this.calls.push(`unsubscribe:${inputScopeRef.ownerId}`);
    };
  }

  async status(inputScopeRef: AIScopeRef): Promise<PermissionStatusSnapshot> {
    this.calls.push(`status:${inputScopeRef.ownerId}`);
    if (this.behavior.status instanceof Error) throw this.behavior.status;
    if (this.behavior.status === null) return null as unknown as PermissionStatusSnapshot;
    return this.behavior.status ?? {
      scopeRef: inputScopeRef,
      grants: [status()],
      generatedAt: '2026-05-17T00:00:00Z',
    };
  }
}

const sampleGrantSpec: GrantSpec = {
  permissionScope,
  subjectUserId: 'user-1',
  reason: 'Tester Settings permission diagnostics',
};

describe('PermissionClient', () => {
  it('rejects null transport', () => {
    assert.throws(() => new PermissionClient(null as unknown as PermissionTransport), PermissionClientError);
  });

  it('list requires explicit AIScopeRef and returns canonical statuses', async () => {
    const client = new PermissionClient(new StubTransport());
    const grants = await client.list(scopeRef);
    assert.equal(grants[0]?.state, 'granted');
    assert.equal(grants[0]?.scopeRef.ownerId, 'tester.app');
    await assert.rejects(client.list(null as unknown as AIScopeRef), PermissionClientError);
  });

  it('get requires scopeRef + grantId and accepts all canonical states', async () => {
    const states: GrantStatus['state'][] = [
      'pending', 'granted', 'denied', 'expired', 'revoked', 'superseded',
    ];
    for (const state of states) {
      const client = new PermissionClient(new StubTransport({ get: status(state, `grant-${state}`) }));
      const result = await client.get(scopeRef, `grant-${state}`);
      assert.equal(result.state, state);
    }
    await assert.rejects(new PermissionClient(new StubTransport()).get(scopeRef, ''), PermissionClientError);
  });

  it('get rejects non-canonical response state and wraps transport errors', async () => {
    const bad = status('granted');
    const client = new PermissionClient(new StubTransport({
      get: { ...bad, state: 'maybe-granted' as 'granted' },
    }));
    await assert.rejects(client.get(scopeRef, 'g'), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'non-canonical-response');
      return true;
    });
    await assert.rejects(
      new PermissionClient(new StubTransport({ get: new Error('boom') })).get(scopeRef, 'g'),
      (err: unknown) => {
        assert.ok(err instanceof PermissionClientError);
        assert.equal((err as PermissionClientError).code, 'transport-error');
        return true;
      },
    );
  });

  it('request requires scopeRef + grantSpec and returns pending accepted projection', async () => {
    const client = new PermissionClient(new StubTransport());
    const result = await client.request(scopeRef, sampleGrantSpec);
    assert.equal(result.accepted, true);
    assert.equal(result.state, 'pending');
    assert.equal(result.scopeRef.ownerId, 'tester.app');
    await assert.rejects(client.request(scopeRef, { ...sampleGrantSpec, reason: '' }), PermissionClientError);
  });

  it('request rejects non-canonical permission scope names before transport', async () => {
    const transport = new StubTransport();
    const client = new PermissionClient(transport);
    await assert.rejects(
      client.request(scopeRef, {
        ...sampleGrantSpec,
        permissionScope: { ...permissionScope, scopeName: 'account.open-ended' as 'account.read' },
      }),
      (err: unknown) => {
        assert.ok(err instanceof PermissionClientError);
        assert.equal((err as PermissionClientError).code, 'non-canonical-response');
        return true;
      },
    );
    assert.deepEqual(transport.calls, []);
  });

  it('request rejects non-pending accepted response', async () => {
    const client = new PermissionClient(new StubTransport({
      request: { scopeRef, accepted: true, grantId: 'g', state: 'granted' as 'pending' },
    }));
    await assert.rejects(client.request(scopeRef, sampleGrantSpec), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('revoke returns canonical revoked status', async () => {
    const client = new PermissionClient(new StubTransport());
    const revoked = await client.revoke(scopeRef, 'grant-1');
    assert.equal(revoked.state, 'revoked');
  });

  it('subscribe validates lifecycle events and returns unsubscribe', () => {
    const transport = new StubTransport();
    const client = new PermissionClient(transport);
    const events: PermissionGrantEvent[] = [];
    const unsubscribe = client.subscribe(scopeRef, (event) => {
      events.push(event);
    });
    assert.equal(events[0]?.grant.state, 'granted');
    unsubscribe();
    assert.deepEqual(transport.calls, ['subscribe:tester.app', 'unsubscribe:tester.app']);
  });

  it('status returns a scoped grant snapshot', async () => {
    const client = new PermissionClient(new StubTransport());
    const snapshot = await client.status(scopeRef);
    assert.equal(snapshot.scopeRef.ownerId, 'tester.app');
    assert.equal(snapshot.grants[0]?.grant.permissionScope.scopeName, 'account.read');
  });

  it('rejects responses scoped to a different AIScopeRef', async () => {
    const client = new PermissionClient(new StubTransport({
      list: [{ ...status(), scopeRef: { kind: 'app', ownerId: 'other.app' } }],
    }));
    await assert.rejects(client.list(scopeRef), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('rejects non-canonical permission scope families', async () => {
    const client = new PermissionClient(new StubTransport());
    await assert.rejects(
      client.request(scopeRef, {
        ...sampleGrantSpec,
        permissionScope: { ...permissionScope, scopeFamily: 'open-ended' as 'account' },
      }),
      (err: unknown) => {
        assert.ok(err instanceof PermissionClientError);
        assert.equal((err as PermissionClientError).code, 'non-canonical-response');
        return true;
      },
    );
  });

  it('rejects non-canonical permission scope names in transport responses', async () => {
    const client = new PermissionClient(new StubTransport({
      get: {
        ...status('granted', 'grant-bad-scope'),
        grant: {
          ...status('granted', 'grant-bad-scope').grant,
          permissionScope: { ...permissionScope, scopeName: 'open.scope' as 'account.read' },
        },
      },
    }));
    await assert.rejects(client.get(scopeRef, 'grant-bad-scope'), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'non-canonical-response');
      return true;
    });
  });
});
