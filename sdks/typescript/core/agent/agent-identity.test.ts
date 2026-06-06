import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AgentIdentityClient,
  CANONICAL_AGENT_TIERS,
  createAgentIdentityProjectionClient,
  isCanonicalAgentTier,
  type AgentIdentityTransport,
  type AgentReference,
} from './identity';

const testDir = dirname(fileURLToPath(import.meta.url));

class StubTransport implements AgentIdentityTransport {
  constructor(
    private readonly behavior: {
      readonly get?: AgentReference | Error | null | Record<string, unknown>;
      readonly list?: readonly AgentReference[] | Error | null | unknown;
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
    if (this.behavior.list !== undefined) return this.behavior.list as readonly AgentReference[];
    return [{ agentRefId: 'ref-1', tier: 'account-scoped', subjectUserId }];
  }
}

describe('AgentIdentityClient', () => {
  it('requires explicit read-only projection transport', () => {
    assert.throws(
      () => new AgentIdentityClient(null as unknown as AgentIdentityTransport),
      /explicit read-only projection transport/,
    );
  });

  it('exports canonical tiers without local identity truth', () => {
    assert.deepEqual(CANONICAL_AGENT_TIERS, ['account-scoped', 'family-scoped', 'persona-scoped']);
    assert.equal(isCanonicalAgentTier('account-scoped'), true);
    assert.equal(isCanonicalAgentTier('app-local'), false);
  });

  it('agent identity source exposes only reference projection verbs', () => {
    const source = readFileSync(resolve(testDir, 'identity.ts'), 'utf8');
    const forbidden = /\b(mintAgentIdentity|createAgentIdentity|ownAgentIdentity|promoteAgent)\b/;
    assert.doesNotMatch(source, forbidden);
  });

  it('gets and lists valid agent references', async () => {
    const client = createAgentIdentityProjectionClient(new StubTransport());
    const ref = await client.getAgentReference('ref-1');
    assert.equal(ref.agentRefId, 'ref-1');
    assert.equal(ref.tier, 'account-scoped');
    const refs = await client.listAgentReferencesForUser('user-1');
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.subjectUserId, 'user-1');
  });

  it('fails closed on missing inputs and malformed projection rows', async () => {
    const client = new AgentIdentityClient(new StubTransport());
    await assert.rejects(client.getAgentReference(''), /requires refId/);
    await assert.rejects(client.listAgentReferencesForUser(''), /requires subjectUserId/);
    await assert.rejects(
      new AgentIdentityClient(new StubTransport({
        get: { agentRefId: 'r', tier: 'app-local', subjectUserId: 'u' },
      })).getAgentReference('r'),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AGENT_IDENTITY_NON_CANONICAL_RESPONSE');
        return true;
      },
    );
    await assert.rejects(
      new AgentIdentityClient(new StubTransport({
        get: { agentRefId: 'r', tier: 'account-scoped', subjectUserId: 'u', appOwnedIdentity: 'rogue' },
      })).getAgentReference('r'),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AGENT_IDENTITY_APP_LOCAL_TRUTH');
        return true;
      },
    );
    await assert.rejects(
      new AgentIdentityClient(new StubTransport({ list: 'not-array' })).listAgentReferencesForUser('u'),
      /response must be an array/,
    );
  });

  it('wraps transport errors as SDK agent identity errors', async () => {
    const client = new AgentIdentityClient(new StubTransport({ get: new Error('boom') }));
    await assert.rejects(client.getAgentReference('r'), (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AGENT_IDENTITY_TRANSPORT_ERROR');
      return true;
    });
  });
});
