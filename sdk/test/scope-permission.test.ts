import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionClient, PermissionClientError } from '../src/scope/permission/index.js';
import type {
  GrantRequest,
  GrantRequestAccepted,
  GrantStatus,
  PermissionTransport,
} from '../src/scope/permission/index.js';

class StubTransport implements PermissionTransport {
  constructor(
    private readonly behavior: {
      readonly status?: GrantStatus | Error | null;
      readonly request?: GrantRequestAccepted | Error | null;
    } = {},
  ) {}

  async getGrantStatus(grantId: string): Promise<GrantStatus> {
    if (this.behavior.status instanceof Error) throw this.behavior.status;
    if (this.behavior.status === null) return null as unknown as GrantStatus;
    if (this.behavior.status !== undefined) return this.behavior.status;
    return {
      grant: { grantId, appId: 'avatar', subjectUserId: 'user-1', scopeKey: 'avatar.mood.read' },
      state: 'granted',
      issuedAt: '2026-05-17T00:00:00Z',
    };
  }

  async requestGrant(_request: GrantRequest): Promise<GrantRequestAccepted> {
    if (this.behavior.request instanceof Error) throw this.behavior.request;
    if (this.behavior.request === null) return null as unknown as GrantRequestAccepted;
    if (this.behavior.request !== undefined) return this.behavior.request;
    return { accepted: true, grantId: 'grant-1', state: 'requested' };
  }
}

const sampleRequest: GrantRequest = {
  appId: 'parentos',
  subjectUserId: 'user-1',
  scopeKey: 'avatar.mood.read',
  reason: 'ParentOS dashboard projection',
};

describe('PermissionClient', () => {
  it('rejects null transport', () => {
    assert.throws(() => new PermissionClient(null as unknown as PermissionTransport), PermissionClientError);
  });

  it('getGrantStatus returns canonical status', async () => {
    const client = new PermissionClient(new StubTransport());
    const status = await client.getGrantStatus('grant-1');
    assert.equal(status.state, 'granted');
    assert.equal(status.grant.grantId, 'grant-1');
  });

  it('getGrantStatus rejects missing grantId', async () => {
    const client = new PermissionClient(new StubTransport());
    await assert.rejects(client.getGrantStatus(''), PermissionClientError);
  });

  it('getGrantStatus rejects non-canonical state', async () => {
    const bad: GrantStatus = {
      grant: { grantId: 'g', appId: 'a', subjectUserId: 's', scopeKey: 'k' },
      state: 'maybe-granted' as 'granted',
    };
    const client = new PermissionClient(new StubTransport({ status: bad }));
    await assert.rejects(client.getGrantStatus('g'), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('getGrantStatus accepts all canonical grant states', async () => {
    const states: GrantStatus['state'][] = [
      'requested', 'prompted', 'granted', 'in-use',
      'revoked', 'expired', 'denied', 'failed',
    ];
    for (const state of states) {
      const status: GrantStatus = {
        grant: { grantId: 'g', appId: 'a', subjectUserId: 's', scopeKey: 'k' },
        state,
      };
      const client = new PermissionClient(new StubTransport({ status }));
      const result = await client.getGrantStatus('g');
      assert.equal(result.state, state);
    }
  });

  it('getGrantStatus rejects response missing grant', async () => {
    const bad = { state: 'granted' } as unknown as GrantStatus;
    const client = new PermissionClient(new StubTransport({ status: bad }));
    await assert.rejects(client.getGrantStatus('g'), PermissionClientError);
  });

  it('getGrantStatus wraps transport errors', async () => {
    const client = new PermissionClient(new StubTransport({ status: new Error('boom') }));
    await assert.rejects(client.getGrantStatus('g'), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'transport-error');
      return true;
    });
  });

  it('requestGrant returns accepted with requested state', async () => {
    const client = new PermissionClient(new StubTransport());
    const result = await client.requestGrant(sampleRequest);
    assert.equal(result.accepted, true);
    assert.equal(result.state, 'requested');
  });

  it('requestGrant rejects missing appId', async () => {
    const client = new PermissionClient(new StubTransport());
    await assert.rejects(client.requestGrant({ ...sampleRequest, appId: '' }), PermissionClientError);
  });

  it('requestGrant rejects missing scopeKey', async () => {
    const client = new PermissionClient(new StubTransport());
    await assert.rejects(client.requestGrant({ ...sampleRequest, scopeKey: '' }), PermissionClientError);
  });

  it('requestGrant rejects missing subjectUserId', async () => {
    const client = new PermissionClient(new StubTransport());
    await assert.rejects(client.requestGrant({ ...sampleRequest, subjectUserId: '' }), PermissionClientError);
  });

  it('requestGrant rejects missing reason', async () => {
    const client = new PermissionClient(new StubTransport());
    await assert.rejects(client.requestGrant({ ...sampleRequest, reason: '' }), PermissionClientError);
  });

  it('requestGrant rejects response with non-canonical state', async () => {
    const bad: GrantRequestAccepted = { accepted: true, grantId: 'g', state: 'granted' as 'requested' };
    const client = new PermissionClient(new StubTransport({ request: bad }));
    await assert.rejects(client.requestGrant(sampleRequest), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('requestGrant wraps transport errors', async () => {
    const client = new PermissionClient(new StubTransport({ request: new Error('boom') }));
    await assert.rejects(client.requestGrant(sampleRequest), (err: unknown) => {
      assert.ok(err instanceof PermissionClientError);
      assert.equal((err as PermissionClientError).code, 'transport-error');
      return true;
    });
  });

  it('requestGrant rejects null response', async () => {
    const client = new PermissionClient(new StubTransport({ request: null }));
    await assert.rejects(client.requestGrant(sampleRequest), PermissionClientError);
  });
});
