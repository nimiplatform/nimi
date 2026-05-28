import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from '@nimiplatform/sdk/runtime/generated/google/protobuf/timestamp';
import { ConversationAnchorStatus } from '@nimiplatform/sdk/runtime/generated/runtime/v1/agent_service';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { toAgentRuntimeConversationSummary } from '../src/shell/renderer/features/chat/chat-agent-runtime-conversation-summaries.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

function readWorkspaceFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

test('Agent Chat spec forbids draft, archive, rename, and offline transcript persistence', () => {
  const spec = readWorkspaceFile('.nimi/spec/desktop/kernel/agent-chat-projection-contract.md');

  assert.match(spec, /D-LLM-025a/);
  assert.match(spec, /limited to renderer UI state and a disposable projection cache/);
  assert.match(spec, /must not become canonical Agent Chat transcript/);
  assert.match(spec, /must not provide offline Agent Chat transcript\s+recovery/);
  assert.match(spec, /must not persist Agent Chat drafts/);
  assert.match(spec, /must not admit Agent Chat rename or archive conversation semantics/);
  assert.match(spec, /single active Runtime conversation per AgentFriend/);
  assert.match(spec, /Runtime-owned session snapshots and `runtime\.agent\.turn\.\*`/);
  assert.match(spec, /Desktop `chat_agent_\*` store exists before cutover/);
});

test('Agent Chat store deletion is gated on Runtime and SDK replacement coverage', () => {
  const desktopSpec = readWorkspaceFile('.nimi/spec/desktop/kernel/agent-chat-projection-contract.md');
  const runtimeSpec = readWorkspaceFile('.nimi/spec/runtime/kernel/runtime-agent-service-contract.md');

  assert.match(desktopSpec, /D-LLM-107/);
  assert.match(desktopSpec, /must not hard-delete the `chat_agent_\*` projection-cache store/);
  assert.match(desktopSpec, /conversation summaries/);
  assert.match(desktopSpec, /GetPublicChatSessionSnapshot/);
  assert.match(desktopSpec, /Agent Chat draft persistence is not a product requirement/);
  assert.match(desktopSpec, /message-level delete \/ redact policy/);
  assert.match(desktopSpec, /one active conversation per\s+AgentFriend/);
  assert.match(desktopSpec, /in-memory optimistic projection only/);

  assert.match(runtimeSpec, /K-AGCORE-006a/);
  assert.match(runtimeSpec, /conversation summary listing scoped to the authenticated calling app/);
  assert.match(runtimeSpec, /close \/ delete \/ clear policy/);
  assert.match(runtimeSpec, /message-level delete \/ redact policy/);
  assert.match(runtimeSpec, /explicit rejection of Agent Chat draft persistence/);
  assert.match(runtimeSpec, /do not admit Desktop-local transcript/);
});

test('Runtime admits Agent Chat conversation summaries before store cutover implementation', () => {
  const runtimeSpec = readWorkspaceFile('.nimi/spec/runtime/kernel/runtime-agent-service-contract.md');
  const rpcMethods = readWorkspaceFile('.nimi/spec/runtime/kernel/tables/rpc-methods.yaml');
  const sdkMethods = readWorkspaceFile('.nimi/spec/sdk/kernel/tables/runtime-method-groups.yaml');

  assert.match(runtimeSpec, /K-AGCORE-006b/);
  assert.match(runtimeSpec, /ListAgentConversationSummaries/);
  assert.match(runtimeSpec, /derived\s+presentation text/);
  assert.match(runtimeSpec, /does not admit close, delete, clear, archive, rename, draft, or/);
  assert.match(runtimeSpec, /rename and archive are not product surfaces/);
  assert.match(runtimeSpec, /one active Agent Chat conversation per AgentFriend/);
  assert.match(runtimeSpec, /K-AGCORE-006c/);
  assert.match(runtimeSpec, /Runtime-owned replay identity fields/);
  assert.match(runtimeSpec, /must not be re-derived differently by apps/);
  assert.match(runtimeSpec, /does not admit offline Agent Chat transcript recovery/);
  assert.match(rpcMethods, /name: ListAgentConversationSummaries[\s\S]*?type: unary/);
  assert.match(sdkMethods, /service: RuntimeAgentService[\s\S]*?ListAgentConversationSummaries/);
});

test('Desktop wires Runtime Agent conversation summaries as read-only projection', () => {
  const adapter = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-conversation-summaries.ts',
  );
  const state = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts',
  );

  assert.match(adapter, /runtime\.agent\.anchors\.listSummaries/);
  assert.match(adapter, /ConversationAnchorStatus\.ACTIVE/);
  assert.match(adapter, /export type AgentRuntimeConversationSummary/);
  assert.doesNotMatch(adapter, /chatAgentStoreClient/);
  assert.doesNotMatch(adapter, /commitTurnResult|getThreadBundle|createThread|putDraft|deleteThread/);

  assert.match(state, /listRuntimeAgentConversationSummaries/);
  assert.match(state, /runtimeConversationSummariesQuery/);
  assert.match(state, /runtimeConversationSummariesReady/);
  // Active selection must not read from the migration-scoped chat_agent_*
  // listThreads store; it derives from the selected localAgentRef plus the
  // Runtime conversation summary projection (D-LLM-025a / D-LLM-107).
  assert.doesNotMatch(state, /chatAgentStoreClient\.listThreads/);
  assert.match(state, /synthesizeAgentThreadSummaryFromRuntimeSummary/);
  assert.match(state, /synthesizeAgentThreadSummaryFromTarget/);
  assert.match(state, /createAgentConversationCacheThreadId/);
  assert.match(state, /threadsReady:\s*runtimeConversationSummariesReady/);
  // getThreadBundle stays only as a remediation fallback for previously
  // committed media/artifact projection rows until Runtime owns those
  // projections directly.
  assert.match(state, /remediationBundleQuery/);
  assert.match(state, /Remediation-only committed media\/artifact projection cache fallback/);
});

test('Runtime Agent conversation summary adapter keeps Runtime anchor identity explicit', () => {
  const target: AgentLocalTargetSnapshot = {
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    displayName: 'Guide',
    handle: '@guide',
    avatarUrl: null,
    presentationProfile: null,
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  };

  const summary = toAgentRuntimeConversationSummary(target, {
    anchor: {
      conversationAnchorId: 'anchor-1',
      agentId: '',
      subjectUserId: 'owner-1',
      status: ConversationAnchorStatus.ACTIVE,
      lastTurnId: 'turn-1',
      lastMessageId: 'msg-anchor',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      realmAgentId: 'agent-1',
      createdAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
      updatedAt: Timestamp.create({ seconds: '1700000001', nanos: 250000000 }),
    },
    title: 'Runtime title',
    lastMessageRole: 'assistant',
    lastMessageText: 'Hello from Runtime',
    lastMessageId: 'msg-summary',
    transcriptMessageCount: 2,
    updatedAt: Timestamp.create({ seconds: '1700000002', nanos: 500000000 }),
  });

  assert.equal(summary?.conversationAnchorId, 'anchor-1');
  assert.equal(summary?.localAgentRef, target.localAgentRef);
  assert.equal(summary?.lastMessageId, 'msg-summary');
  assert.equal(summary?.updatedAtMs, 1700000002500);
  assert.equal(summary?.targetSnapshot, target);
});

test('Desktop command classification treats chat_agent store commands as migration-scoped', () => {
  const table = readWorkspaceFile('.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml');

  assert.doesNotMatch(table, /memory_embedding_runtime_(?:inspect|request_bind|request_cutover)/);
  assert.match(table, /family: chat_ai_local_store[\s\S]*?regex: "\^chat_ai_\.\*\$"[\s\S]*?remediation_required: false/);
  assert.match(table, /family: chat_agent_projection_cache_migration[\s\S]*?regex: "\^chat_agent_\.\*\$"/);
  assert.match(table, /owner_domain: desktop-agent-chat-projection-cache-migration/);
  assert.match(table, /family: chat_agent_projection_cache_migration[\s\S]*?remediation_required: true/);
});

test('Desktop projection cache no longer exposes local Agent Chat message mutation commands', () => {
  const bootstrap = readWorkspaceFile('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
  const commands = readWorkspaceFile('apps/desktop/src-tauri/src/chat_agent_store/commands.rs');
  const bridge = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-store.ts',
  );

  assert.doesNotMatch(bootstrap, /chat_agent_create_message/);
  assert.doesNotMatch(bootstrap, /chat_agent_delete_message/);
  assert.doesNotMatch(commands, /chat_agent_create_message/);
  assert.doesNotMatch(commands, /chat_agent_delete_message/);
  assert.doesNotMatch(bridge, /createMessage\(/);
  assert.doesNotMatch(bridge, /deleteMessage\(/);
});

test('Desktop projection cache no longer exposes local Agent Chat cancel or rebuild commands', () => {
  const bootstrap = readWorkspaceFile('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
  const commands = readWorkspaceFile('apps/desktop/src-tauri/src/chat_agent_store/commands.rs');
  const bridge = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-store.ts',
  );
  const runtimeProvider = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-provider.ts',
  );

  assert.doesNotMatch(bootstrap, /chat_agent_cancel_turn|chat_agent_rebuild_projection/);
  assert.doesNotMatch(commands, /chat_agent_cancel_turn|chat_agent_rebuild_projection/);
  assert.doesNotMatch(bridge, /cancelTurn\(|rebuildProjection\(/);
  assert.doesNotMatch(runtimeProvider, /chat-agent-continuity|commitProviderOutcome|createAgentLocalChatContinuityAdapter/);
  assert.doesNotMatch(runtimeProvider, /chatAgentStoreClient\.commitTurnResult/);
});
