import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiAppCharacterDiscoveryRuntimeClient } from './local-app-character-discovery.js';
import { toRuntimeCharacterSourceRefV3 } from '../../runtime/runtime-materialization-input.js';
import { parseNimiDesktopOpenIntent } from './desktop-open.js';

test('Character discovery carries the exact source, cursor and returned partner through the public client', async () => {
  const source = { kind: 'personaCharacter' as const, id: 'character', worldId: 'world', ownerAccountId: 'author', sourceHash: 'a'.repeat(64) };
  const partner = { agentHandle: `agent_ref_${'a'.repeat(43)}`, agentBinding: `agent_binding_${'b'.repeat(43)}`, activityAgentRef: 'agr_partner', displayName: 'Partner' };
  const reads: unknown[] = [], writes: unknown[] = [];
  const client = createNimiAppCharacterDiscoveryRuntimeClient({
    async listLocalAppCharacterSources(input) { reads.push(input); return { items: [{ sourceRef: toRuntimeCharacterSourceRefV3(source), displayName: 'Partner', summary: 'Public description', worldName: 'World', disposition: '', traits: [], topics: [], connectable: true, existingPartner: partner }], nextCursor: 'next' }; },
    async connectLocalAppCharacterSource(input) { writes.push(input); return { partner, created: false }; },
  });
  const page = await client.listCharacters({ query: 'Partner', cursor: 'cursor', pageSize: 10 });
  assert.deepEqual(reads, [{ query: 'Partner', cursor: 'cursor', pageSize: 10 }]);
  assert.deepEqual(page.items[0]?.sourceRef, source);
  assert.equal(page.items[0]?.existingPartner?.agentHandle, partner.agentHandle);
  const result = await client.connectCharacter({ sourceRef: source, requestId: 'explicit-request' });
  assert.equal(result.created, false); assert.equal(result.partner.agentHandle, partner.agentHandle);
  assert.deepEqual(writes, [{ sourceRef: toRuntimeCharacterSourceRefV3(source), requestId: 'explicit-request' }]);
  await assert.rejects(client.connectCharacter({ sourceRef: { ...source, accountId: 'injected' } as never, requestId: 'invalid' }));
  assert.equal(writes.length, 1);
});

test('Home world handoff accepts only an exact public world reference', () => {
  assert.deepEqual(parseNimiDesktopOpenIntent({ kind: 'open-world', worldId: 'world_123' }), { kind: 'open-world', worldId: 'world_123' });
  assert.throws(() => parseNimiDesktopOpenIntent({ kind: 'open-world', worldId: 'https://private' }));
  assert.throws(() => parseNimiDesktopOpenIntent({ kind: 'open-world', worldId: 'world_123', accountId: 'foreign' }));
});
