import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { ensureCharacterSourceMaterialized } from '../src/shell/renderer/features/relationship/character-source-launch-target.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { React, renderToStaticMarkup, initI18n, SourceDetailView, toSourceDetailData, liBaiRaw } from './source-detail-world-character-test-utils.js';
import { CharacterSourceDetailPage } from '../src/shell/renderer/features/source-detail/source-detail-world-character-view.js';

const sourceRef = { kind: 'personaCharacter' as const, id: 'character', worldId: 'world', ownerAccountId: 'author', sourceHash: 'a'.repeat(64) };
const source = { id: 'character', handle: 'character', bio: null, sourceRef };
const i18n = createInstance();
await i18n.init({ lng: 'en', resources: {} });

function record(localAgentRef = 'local-agent:existing', lifecycleStatus = AgentLifecycleStatus.ACTIVE) {
  return { localAgentRef, ownerUserId: 'owner', displayName: 'Partner', lifecycleStatus,
    sourceContextStatus: { schemaVersion: 2, ready: false, state: 4, reasonCode: 4, localAgentRef,
      sourceSchemaVersion: 'realm.persona-character-core/v1',
      sourceRef: { personaCharacter: { ...sourceRef, kind: 2, sourceHash: 'b'.repeat(64) } } } };

}
function sdkWithPages(pages: unknown[]) {
  let writes = 0;
  return { writes: () => writes, sdk: {
    withRuntimeProtectedScopes: async (_scopes: unknown, call: (options: object) => unknown) => call({}),
    accountProduct: () => ({ agents: { listAgents: async () => {
      const page = pages.shift(); if (page instanceof Error) throw page; return page;
    } }, materializeRealmSource: async () => { writes++; throw new Error('unexpected creation'); } }),
  } as unknown as DesktopRendererSdkPort };
}

test('a partner from an older source version, including a suspended partner on a later page, is reused', async () => {
  for (const state of [AgentLifecycleStatus.ACTIVE, AgentLifecycleStatus.SUSPENDED, AgentLifecycleStatus.INITIALIZING, AgentLifecycleStatus.TERMINATING]) {
    const f = sdkWithPages([{ agents: [], nextPageToken: 'next' }, { agents: [record('local-agent:existing', state)], nextPageToken: '' }]);
    assert.equal(await ensureCharacterSourceMaterialized(source, 'owner', i18n.t, f.sdk, () => true), 'local-agent:existing');
    assert.equal(f.writes(), 0);
  }
});
test('unknown or duplicate inventory cannot authorize creation or arbitrary selection', async () => {
  for (const pages of [[new Error('offline')], [{ agents: [{ ...record(), sourceContextStatus: undefined }], nextPageToken: '' }], [{ agents: [record(), record('local-agent:other')], nextPageToken: '' }]]) {
    const f = sdkWithPages(pages);
    await assert.rejects(ensureCharacterSourceMaterialized(source, 'owner', i18n.t, f.sdk, () => true));
    assert.equal(f.writes(), 0);
  }
});
test('source detail offers the exact partner action without duplicate creation or instance selection', async () => {
  await initI18n();
  const html = renderToStaticMarkup(<SourceDetailView source={toSourceDetailData(liBaiRaw, 'local_agent_available')} loading={false} error={false} onOpenWorld={() => {}} onPrimaryAction={() => {}} />);
  assert.match(html, /data-primary-action="open_partner"/);
  assert.doesNotMatch(html, /Create another|创建另一位|character-choose-partner/);
});
test('partner presentation preserves Runtime identity, public profile and collapsed first-meeting reference', () => {
  const html = renderToStaticMarkup(<CharacterSourceDetailPage source={toSourceDetailData(liBaiRaw, 'local_agent_available')}
    onOpenWorld={() => {}} onPrimaryAction={() => {}}
    partner={{ displayName: 'Runtime partner', actions: <button>Chat with partner</button>, status: <p>Owner state</p>, sourceNotice: <p>Public profile updated</p> }} />);
  assert.match(html, /Runtime partner/);
  assert.match(html, /盛唐诗人/);
  assert.match(html, /Owner state/);
  assert.match(html, /Public profile updated/);
  assert.doesNotMatch(html, /data-primary-action=/);
});
