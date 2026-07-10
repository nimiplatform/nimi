import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDesktopFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
}

const oldSourceDomainName = ['ag', 'ent'].join('');
const oldGroupSourcePascal = ['Group', 'Ag', 'ent'].join('');
const oldGroupSourceMessagePath = ['/', oldSourceDomainName, '-messages'].join('');
const oldRuntimeSourceTurnRequest = ['runtime', oldSourceDomainName, 'turn', 'request'].join('.');
const oldRealmCommitSlotField = ['expectedRuntimeParticipant', 'Slot'].join('');
const oldRuntimeLocalSourceField = ['expectedLocal', 'AgentRef'].join('');

function escapedPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

describe('Realm group source participation Desktop hardcut', () => {
  it('removes Desktop-local group source trigger authority', () => {
    const dispatcherPath = resolve(
      __dirname,
      `../src/shell/renderer/features/chat/chat-group-${oldSourceDomainName}-dispatcher.ts`,
    );

    assert.equal(existsSync(dispatcherPath), false);
  });

  it('removes Desktop public direct source message commit facade', () => {
    const flowSource = readDesktopFile('src/shell/renderer/features/chat/data/realm-group-chat-data.ts');
    const oldSendGroupMessage = new RegExp(['send', oldGroupSourcePascal, 'Message'].join(''));
    const oldSendGroupChatMessage = new RegExp(['send', oldGroupSourcePascal, 'ChatMessage'].join(''));
    const oldGeneratedServiceMethod = new RegExp(['GroupChatsService', ['send', oldGroupSourcePascal, 'Message'].join('')].join('\\\\.'));

    assert.doesNotMatch(flowSource, oldSendGroupMessage);
    assert.doesNotMatch(flowSource, oldSendGroupChatMessage);
    assert.doesNotMatch(flowSource, oldGeneratedServiceMethod);
  });

  it('wires split Runtime candidate/evidence read and Realm commit facades', () => {
    const flowSource = readDesktopFile('src/shell/renderer/features/chat/data/realm-group-chat-data.ts');

    assert.match(flowSource, /createNimiHostRuntimeRealmGroupMessageCandidateSurface/);
    assert.match(flowSource, /createCommitPayload/);
    assert.match(flowSource, /getDesktopRuntime\(\)\.agents/);
    assert.match(flowSource, /getDesktopAppId\(\)/);
    assert.doesNotMatch(flowSource, /createHostRuntimeRealmGroupMessageCandidateSurface/);
    assert.doesNotMatch(flowSource, /getPlatformClient/);
    assert.doesNotMatch(flowSource, /createRuntimeProtectedScopeHelper/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.createRealmGroupMessageCandidate/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.getRealmGroupMessageCandidateEvidence/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.create_realm_group_message_candidate/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.get_realm_group_message_candidate_evidence/);
    assert.doesNotMatch(flowSource, /GroupChatsService\.publishRealmGroupMessageCandidateEvidence/);
    assert.doesNotMatch(flowSource, /GroupChatsService\./);
    assert.match(flowSource, /commitNimiRealmGroupSourceMessageCandidate/);
    assert.match(flowSource, /addNimiRealmGroupSourceParticipant/);
    assert.match(flowSource, /removeNimiRealmGroupSourceParticipant/);
    assert.match(flowSource, /commitRealmGroupSourceMessageCandidate/);
    assert.match(flowSource, /createCommitPayload/);
    assert.doesNotMatch(flowSource, /not implemented in current Realm SDK surface/);
    assert.doesNotMatch(flowSource, /addNimiRealmGroupParticipant/);
    assert.doesNotMatch(flowSource, /removeNimiRealmGroupParticipant/);
    assert.doesNotMatch(flowSource, /sourceAccountId/);
    assert.doesNotMatch(flowSource, /candidateEvidenceRef: candidate\.candidateEvidenceRef/);
    assert.doesNotMatch(flowSource, /outputCandidateRef: evidence\.outputCandidateRef/);
    assert.doesNotMatch(flowSource, /assertCandidateHandleMatchesExpectedSlot/);
    assert.doesNotMatch(flowSource, /assertCandidateEvidenceMatchesHandle/);
    assert.doesNotMatch(flowSource, escapedPattern(`${oldRealmCommitSlotField}: slot.runtimeParticipantSlot`));
    assert.doesNotMatch(flowSource, escapedPattern(`${oldRuntimeLocalSourceField}: slot.localAgentRef`));
    assert.doesNotMatch(flowSource, /unsafeRaw|fetch\(|message_committed/);
    assert.doesNotMatch(flowSource, escapedPattern(oldGroupSourceMessagePath));
    assert.doesNotMatch(flowSource, escapedPattern(oldRuntimeSourceTurnRequest));
  });

  it('keeps group surfaces free of local execution and scheduling imports', () => {
    const adapterSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-adapter.tsx');
    const participantPanelSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-participant-panel.tsx');
    const composerSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-composer.tsx');

    for (const source of [adapterSource, participantPanelSource, composerSource]) {
      assert.doesNotMatch(source, new RegExp(`chat-${oldSourceDomainName}-continuity`));
      assert.doesNotMatch(source, new RegExp(`chat-${oldSourceDomainName}-orchestration`));
      assert.doesNotMatch(source, new RegExp(`chat-${oldSourceDomainName}-runtime-memory`));
      assert.doesNotMatch(source, new RegExp(['create', 'Ag', 'ent', 'LocalChatConversationRuntimeAdapter'].join('')));
      assert.doesNotMatch(source, /runtime\.orchestration/);
      assert.doesNotMatch(source, /GROUP_LIMITED/);
    }
  });

  it('fails closed on slot removal when Realm admin evidence is absent', () => {
    const panelSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-participant-panel.tsx');

    assert.doesNotMatch(panelSource, new RegExp(`${oldSourceDomainName}OwnerId\\\\s*===\\\\s*currentUserId`));
    assert.match(panelSource, /canManageSourceSlots/);
    assert.match(panelSource, /p\.role === 'admin'/);
  });

  it('keeps chat invalidation on broker-mediated projection refresh without Desktop source dispatch', () => {
    const realtimeSource = readDesktopFile('src/shell/renderer/features/realtime/use-chat-realtime-sync.ts');

    assert.doesNotMatch(realtimeSource, new RegExp(`trigger ${oldSourceDomainName} dispatch`));
    assert.match(realtimeSource, /syncThroughBroker/);
    assert.match(realtimeSource, /queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\)/);
    assert.doesNotMatch(realtimeSource, /applyChatEventToCache|Authorization|Bearer|socket\.io/);
  });
});
