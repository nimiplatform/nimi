import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDesktopFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
}

describe('Realm group agent participation Desktop hardcut', () => {
  it('removes Desktop-local group agent trigger authority', () => {
    const dispatcherPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-agent-dispatcher.ts',
    );

    assert.equal(existsSync(dispatcherPath), false);
  });

  it('removes Desktop public direct agent message commit facade', () => {
    const flowSource = readDesktopFile('src/shell/renderer/features/chat/data/realm-group-chat-data.ts');

    assert.doesNotMatch(flowSource, /sendGroupAgentMessage/);
    assert.doesNotMatch(flowSource, /sendGroupAgentChatMessage/);
    assert.doesNotMatch(flowSource, /GroupChatsService\.sendGroupAgentMessage/);
  });

  it('wires split Runtime candidate/evidence read and Realm commit facades', () => {
    const flowSource = readDesktopFile('src/shell/renderer/features/chat/data/realm-group-chat-data.ts');

    assert.match(flowSource, /createHostRuntimeRealmGroupMessageCandidateSurface/);
    assert.match(flowSource, /createCommitPayload/);
    assert.doesNotMatch(flowSource, /createRuntimeProtectedScopeHelper/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.createRealmGroupMessageCandidate/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.getRealmGroupMessageCandidateEvidence/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.create_realm_group_message_candidate/);
    assert.doesNotMatch(flowSource, /runtime\.agent\.get_realm_group_message_candidate_evidence/);
    assert.doesNotMatch(flowSource, /GroupChatsService\.publishRealmGroupMessageCandidateEvidence/);
    assert.match(flowSource, /GroupChatsService\.commitRealmGroupMessageCandidate/);
    assert.match(flowSource, /candidateCommit\.realmCommitPayload/);
    assert.doesNotMatch(flowSource, /candidateEvidenceRef: candidate\.candidateEvidenceRef/);
    assert.doesNotMatch(flowSource, /outputCandidateRef: evidence\.outputCandidateRef/);
    assert.doesNotMatch(flowSource, /assertCandidateHandleMatchesExpectedSlot/);
    assert.doesNotMatch(flowSource, /assertCandidateEvidenceMatchesHandle/);
    assert.doesNotMatch(flowSource, /expectedRealmGroupAgentSlotId: slot\.realmGroupAgentSlotId/);
    assert.doesNotMatch(flowSource, /expectedLocalAgentRef: slot\.localAgentRef/);
    assert.doesNotMatch(flowSource, /unsafeRaw|fetch\(|\/agent-messages|message_committed|runtime\.agent\.turn\.request/);
  });

  it('keeps group surfaces free of local execution and scheduling imports', () => {
    const adapterSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-adapter.tsx');
    const participantPanelSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-participant-panel.tsx');
    const composerSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-composer.tsx');

    for (const source of [adapterSource, participantPanelSource, composerSource]) {
      assert.doesNotMatch(source, /chat-agent-continuity/);
      assert.doesNotMatch(source, /chat-agent-orchestration/);
      assert.doesNotMatch(source, /chat-agent-runtime-memory/);
      assert.doesNotMatch(source, /createAgentLocalChatConversationRuntimeAdapter/);
      assert.doesNotMatch(source, /runtime\.orchestration/);
      assert.doesNotMatch(source, /GROUP_LIMITED/);
    }
  });

  it('fails closed on slot removal when Realm admin evidence is absent', () => {
    const panelSource = readDesktopFile('src/shell/renderer/features/chat/chat-group-participant-panel.tsx');

    assert.doesNotMatch(panelSource, /agentOwnerId\s*===\s*currentUserId/);
    assert.match(panelSource, /canManageAgentSlots/);
    assert.match(panelSource, /p\.role === 'admin'/);
  });

  it('does not describe realtime invalidation as Desktop agent dispatch', () => {
    const realtimeSource = readDesktopFile('src/shell/renderer/features/realtime/use-chat-realtime-sync.ts');

    assert.doesNotMatch(realtimeSource, /trigger agent dispatch/);
    assert.match(realtimeSource, /Realm projection refresh only/);
  });
});
