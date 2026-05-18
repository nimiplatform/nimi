import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AgentIdentityClient,
  AgentIdentityClientError,
} from '../src/runtime/agent-identity/index.js';
import type {
  AgentIdentityTransport,
  AgentReference,
} from '../src/runtime/agent-identity/index.js';

class StubTransport implements AgentIdentityTransport {
  constructor(
    private readonly behavior: {
      readonly get?: AgentReference | Error | null | Record<string, unknown>;
      readonly list?: readonly AgentReference[] | Error | null;
    } = {},
  ) {}

  async getAgentReference(refId: string): Promise<AgentReference> {
    if (this.behavior.get instanceof Error) throw this.behavior.get;
    if (this.behavior.get === null) return null as unknown as AgentReference;
    if (this.behavior.get !== undefined) return this.behavior.get as AgentReference;
    return { agentRefId: refId, tier: 'account-scoped', subjectUserId: 'user-1', displayHint: 'Nimi' };
  }

  async listAgentReferencesForUser(subjectUserId: string): Promise<readonly AgentReference[]> {
    if (this.behavior.list instanceof Error) throw this.behavior.list;
    if (this.behavior.list === null) return null as unknown as readonly AgentReference[];
    if (this.behavior.list !== undefined) return this.behavior.list;
    return [{ agentRefId: 'ref-1', tier: 'account-scoped', subjectUserId }];
  }
}

describe('AgentIdentityClient', () => {
  it('rejects null transport', () => {
    assert.throws(() => new AgentIdentityClient(null as unknown as AgentIdentityTransport), AgentIdentityClientError);
  });

  it('SDK module exposes only reference projection, never mint/create/own', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sources = [
      resolve(import.meta.dirname, '../src/runtime/agent-identity/client.ts'),
      resolve(import.meta.dirname, '../src/runtime/agent-identity/types.ts'),
      resolve(import.meta.dirname, '../src/runtime/agent-identity/transport.ts'),
      resolve(import.meta.dirname, '../src/runtime/agent-identity/index.ts'),
    ];
    const forbidden = /\b(mintAgentIdentity|createAgentIdentity|ownAgentIdentity|promoteAgent)\b/;
    for (const sourcePath of sources) {
      const source = readFileSync(sourcePath, 'utf8');
      if (forbidden.test(source)) {
        assert.fail(`forbidden mint/create/own surface found in ${sourcePath}`);
      }
    }
  });

  it('getAgentReference returns valid reference', async () => {
    const client = new AgentIdentityClient(new StubTransport());
    const ref = await client.getAgentReference('ref-1');
    assert.equal(ref.agentRefId, 'ref-1');
    assert.equal(ref.tier, 'account-scoped');
  });

  it('getAgentReference rejects missing refId', async () => {
    const client = new AgentIdentityClient(new StubTransport());
    await assert.rejects(client.getAgentReference(''), AgentIdentityClientError);
  });

  it('getAgentReference rejects non-canonical tier', async () => {
    const bad: AgentReference = { agentRefId: 'r', tier: 'app-local' as 'account-scoped', subjectUserId: 'u' };
    const client = new AgentIdentityClient(new StubTransport({ get: bad }));
    await assert.rejects(client.getAgentReference('r'), (err: unknown) => {
      assert.ok(err instanceof AgentIdentityClientError);
      assert.equal((err as AgentIdentityClientError).code, 'non-canonical-response');
      return true;
    });
  });

  it('getAgentReference rejects forbidden app-local identity field in response', async () => {
    const bad = { agentRefId: 'r', tier: 'account-scoped', subjectUserId: 'u', appLocalIdentity: 'rogue' };
    const client = new AgentIdentityClient(new StubTransport({ get: bad }));
    await assert.rejects(client.getAgentReference('r'), (err: unknown) => {
      assert.ok(err instanceof AgentIdentityClientError);
      assert.equal((err as AgentIdentityClientError).code, 'app-local-identity-truth');
      return true;
    });
  });

  it('getAgentReference rejects missing required field', async () => {
    const bad: AgentReference = { agentRefId: '', tier: 'account-scoped', subjectUserId: 'u' };
    const client = new AgentIdentityClient(new StubTransport({ get: bad }));
    await assert.rejects(client.getAgentReference('r'), AgentIdentityClientError);
  });

  it('getAgentReference wraps transport errors', async () => {
    const client = new AgentIdentityClient(new StubTransport({ get: new Error('boom') }));
    await assert.rejects(client.getAgentReference('r'), (err: unknown) => {
      assert.ok(err instanceof AgentIdentityClientError);
      assert.equal((err as AgentIdentityClientError).code, 'transport-error');
      return true;
    });
  });

  it('listAgentReferencesForUser returns reference list', async () => {
    const client = new AgentIdentityClient(new StubTransport());
    const refs = await client.listAgentReferencesForUser('user-1');
    assert.equal(refs.length, 1);
  });

  it('listAgentReferencesForUser rejects missing subjectUserId', async () => {
    const client = new AgentIdentityClient(new StubTransport());
    await assert.rejects(client.listAgentReferencesForUser(''), AgentIdentityClientError);
  });

  it('listAgentReferencesForUser rejects non-array', async () => {
    const client = new AgentIdentityClient(new StubTransport({ list: 'not-array' as unknown as AgentReference[] }));
    await assert.rejects(client.listAgentReferencesForUser('u'), AgentIdentityClientError);
  });

  it('listAgentReferencesForUser rejects rows with forbidden app-local fields', async () => {
    const bad = [{ agentRefId: 'r', tier: 'account-scoped', subjectUserId: 'u', appOwnedIdentity: 'rogue' }] as AgentReference[];
    const client = new AgentIdentityClient(new StubTransport({ list: bad }));
    await assert.rejects(client.listAgentReferencesForUser('u'), (err: unknown) => {
      assert.ok(err instanceof AgentIdentityClientError);
      assert.equal((err as AgentIdentityClientError).code, 'app-local-identity-truth');
      return true;
    });
  });

  it('listAgentReferencesForUser wraps transport errors', async () => {
    const client = new AgentIdentityClient(new StubTransport({ list: new Error('boom') }));
    await assert.rejects(client.listAgentReferencesForUser('u'), AgentIdentityClientError);
  });
});
