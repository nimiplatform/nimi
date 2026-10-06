import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { createAnotherCharacterSourcePartner } from '../src/shell/renderer/features/relationship/character-source-launch-target.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

const sourceRef = { kind: 'worldCharacter' as const, id: 'character', worldId: 'world', worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world', entityId: 'character' }, sourceHash: 'a'.repeat(64) };
const source = { id: 'character', handle: 'character', bio: null, sourceRef };
const i18n = createInstance();
await i18n.init({ lng: 'en', resources: {} });
const t = i18n.t;

function fixture(posture = 'valid') {
  let calls = 0, reads = 0;
  const old = { localAgentRef: 'local-agent:runtime-old', ownerUserId: 'owner', sourceKind: sourceRef.kind, sourceWorldId: sourceRef.worldId, sourceId: sourceRef.id, sourceHash: sourceRef.sourceHash };
  const created = { ...old, localAgentRef: posture === 'old-result' ? old.localAgentRef : 'local-agent:runtime-new', sourceHash: posture === 'foreign' ? 'b'.repeat(64) : sourceRef.sourceHash };
  const sdk = {
    runtimeAgentDiscovery: () => ({ discoverLocalAgentsBySource: async () => {
      reads++;
      return reads === 1 || posture === 'missing-new' ? [old, { ...old, localAgentRef: 'local-agent:runtime-second' }] : [old, { ...old, localAgentRef: 'local-agent:runtime-second' }, created];
    } }),
    accountProduct: () => ({ materializeRealmSource: async () => { calls++; return { localAgentRef: created.localAgentRef }; } }),
  } as unknown as DesktopRendererSdkPort;
  return { sdk, calls: () => calls };
}

test('explicit another partner verifies the exact new instance with multiple existing partners', async () => {
  const f = fixture();
  await createAnotherCharacterSourcePartner(source, 'owner', t, f.sdk, () => true);
  assert.equal(f.calls(), 1);
});
for (const posture of ['old-result', 'missing-new', 'foreign']) {
  test(`another partner refuses unconfirmed ${posture} and does not retry`, async () => {
    const f = fixture(posture);
    await assert.rejects(createAnotherCharacterSourcePartner(source, 'owner', t, f.sdk, () => true));
    assert.equal(f.calls(), 1);
  });
}
test('expired another partner action does not submit materialization', async () => {
  const f = fixture();
  await assert.rejects(createAnotherCharacterSourcePartner(source, 'owner', t, f.sdk, () => false));
  assert.equal(f.calls(), 0);
});
