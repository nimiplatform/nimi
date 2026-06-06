import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('agent conversation launcher keeps route identity out of runtimeFields', () => {
  const source = readSource('apps/desktop/src/shell/renderer/features/chat/agent-conversation-launcher.ts');
  assert.match(source, /setAgentConversationSelection\(\{/);
  assert.doesNotMatch(source, /setRuntimeFields\(\s*\{/);
  assert.doesNotMatch(source, /runtimeFields[^]*targetAccountId:\s*agentId/);
  assert.doesNotMatch(source, /runtimeFields[^]*targetId:\s*agentId/);
  assert.doesNotMatch(source, /worldId:\s*input\.target\.worldId/);
});

test('agent conversation shell does not expose local thread selection as product surface', () => {
  const adapterSource = readSource('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const presentationSource = readSource('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  const adapterStateSource = readSource('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts');
  const uiSliceSource = readSource('apps/desktop/src/shell/renderer/app-shell/providers/ui-slice.ts');

  assert.doesNotMatch(adapterSource, /onSelectThread:\s*handleSelectThread/u);
  assert.doesNotMatch(presentationSource, /toConversationThreadSummary/u);
  assert.doesNotMatch(presentationSource, /targetSummariesInput\.threads\.map/u);
  assert.match(presentationSource, /listThreads:\s*\(\)\s*=>\s*\[\]/u);
  assert.doesNotMatch(adapterStateSource, /selectionThreadId:\s*input\.selection\.threadId/u);
  assert.doesNotMatch(adapterStateSource, /lastSelectedThreadId:\s*input\.lastSelectedThreadId/u);
  assert.doesNotMatch(adapterStateSource, /selectionThreadId|lastSelectedThreadId/u);
  assert.doesNotMatch(uiSliceSource, /agent:\s*selection\.threadId/u);
  // Active selection must derive from the Runtime conversation summary
  // projection plus localAgentRef, not from chat_agent_* listThreads
  // (D-LLM-025a / D-LLM-107, K-AGCORE-006a/b/c).
  assert.doesNotMatch(adapterStateSource, /chatAgentStoreClient\.listThreads/u);
  assert.doesNotMatch(adapterStateSource, /resolveAgentConversationActiveThreadId/u);
  assert.match(adapterStateSource, /synthesizeAgentThreadSummaryFromRuntimeSummary/u);
  assert.match(adapterStateSource, /createAgentConversationCacheThreadId/u);
});

test('agent runtime summary projection requests one active conversation per AgentFriend', () => {
  const source = readSource('apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-conversation-summaries.ts');
  assert.match(source, /createNimiRuntimeAgentConsumeClient/u);
  assert.match(source, /getDesktopRuntime\(\)\.agents/u);
  assert.match(source, /getDesktopAppId\(\)/u);
  assert.match(source, /anchors\.listSummaries/u);
  assert.match(source, /statusFilter:\s*\['active'\]/u);
  assert.match(source, /pageSize:\s*1/u);
  assert.match(source, /deduped\.get\(summary\.localAgentRef\)/u);
  assert.doesNotMatch(source, /getPlatformClient/u);
  assert.doesNotMatch(source, /runtime\.agent\.anchors\.listSummaries/u);
  assert.doesNotMatch(source, /pageSize:\s*50/u);
  assert.doesNotMatch(source, /deduped\.get\(summary\.conversationAnchorId\)/u);
});

test('agent local projection cache ids are derived from localAgentRef', () => {
  const coreSource = readSource('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-core.ts');
  const helpersSource = readSource('apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.ts');

  assert.match(coreSource, /createAgentConversationCacheThreadId\(localAgentRef: string\)/u);
  assert.match(coreSource, /`agent-thread:\$\{normalizedLocalAgentRef\}`/u);
  assert.match(helpersSource, /id:\s*createAgentConversationCacheThreadId\(target\.localAgentRef\)/u);
  assert.doesNotMatch(helpersSource, /randomIdV11\('agent-thread'\)/u);
});
