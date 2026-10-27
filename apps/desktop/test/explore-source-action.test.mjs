// Discovery no longer creates partners per card. The selected source detail owns
// materialization; these tests exercise its actual helper, never product acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCharacterSourceMaterialized, confirmCharacterSourceMaterialized, CharacterSourceConfirmationPendingError } from '../src/shell/renderer/features/relationship/character-source-launch-target.ts';

const sourceRef = { kind: 'personaCharacter', id: 'persona-1', worldId: 'world-1', ownerAccountId: 'author-1', sourceHash: 'a'.repeat(64) };
const source = { id: sourceRef.id, handle: 'partner', bio: null, sourceRef };
const t = (_key, options) => options?.defaultValue ?? _key;

for (const posture of ['expected', 'other-only', 'concurrent']) {
  test(`creation confirms the returned reference in ${posture} owner inventory`, async () => {
    let writes = 0, reads = 0;
    const sdk = {
      runtimeAgentDiscovery: () => ({ discoverLocalAgentsBySource: async () => {
        if (++reads === 1) return [];
        const expected = { localAgentRef: 'local-agent:new', ownerUserId: 'owner' };
        const other = { localAgentRef: 'local-agent:other', ownerUserId: 'owner' };
        return posture === 'expected' ? [expected] : posture === 'other-only' ? [other] : [other, expected];
      } }),
      accountProduct: () => ({ materializeRealmSource: async () => { writes++; return { localAgentRef: 'local-agent:new' }; } }),
    };
    if (posture === 'other-only') {
      await assert.rejects(ensureCharacterSourceMaterialized(source, 'owner', t, sdk, () => true), error =>
        error instanceof CharacterSourceConfirmationPendingError && error.localAgentRef === 'local-agent:new');
    } else assert.equal(await ensureCharacterSourceMaterialized(source, 'owner', t, sdk, () => true), 'local-agent:new');
    assert.equal(writes, 1);
    assert.equal(reads, 2);
  });
}

test('confirmation retry reads the known reference without issuing a new write', async () => {
  let writes = 0;
  const sdk = {
    runtimeAgentDiscovery: () => ({ discoverLocalAgentsBySource: async () => [{ localAgentRef: 'local-agent:new', ownerUserId: 'owner' }] }),
    accountProduct: () => ({ materializeRealmSource: async () => { writes++; throw new Error('must not write'); } }),
  };
  await confirmCharacterSourceMaterialized(source, 'owner', t, sdk, () => true, 'local-agent:new');
  assert.equal(writes, 0);
});
