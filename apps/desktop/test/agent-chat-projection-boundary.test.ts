import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAnchorStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { toAgentRuntimeConversationSummary } from '../src/shell/renderer/features/chat/chat-agent-runtime-conversation-summaries.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

function readWorkspaceFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function workspacePathExists(path: string): boolean {
  return existsSync(resolve(repoRoot, path));
}

function readAuthorityUnit(container: string, unitId: string): string {
  const normalized = container.replaceAll('\r\n', '\n');
  const marker = `  - id: ${unitId}\n`;
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1, `missing authority unit ${unitId}`);
  const end = normalized.indexOf('\n  - id: ', start + marker.length);
  return normalized.slice(start, end === -1 ? undefined : end);
}

test('Agent Chat spec forbids draft, archive, rename, and offline transcript persistence', () => {
  const spec = readWorkspaceFile('.nimi/spec/canonical/desktop/agent-projection.authority.yaml');
  const projectionTruth = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r002');
  const persistenceScope = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r020');
  const transcriptBoundary = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r021');
  const offlineBoundary = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r022');
  const draftBoundary = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r023');
  const metadataBoundary = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r024');
  const conversationPosture = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r025');
  const retiredStore = readAuthorityUnit(spec, 'rule.nimi.desktop.agent-projection.r026');

  assert.match(persistenceScope, /non-transcript renderer UI state/);
  assert.match(persistenceScope, /disposable projection cache/);
  assert.match(transcriptBoundary, /canonical Agent Chat transcript, message, action, turn, beat, conversation-anchor, lifecycle, history/);
  assert.match(transcriptBoundary, /assistant greeting, successful turn, prompt trace, turn trace, or projection-rebuild truth/);
  assert.match(offlineBoundary, /reconstructs Agent Chat transcript or history from local storage after reload or restart/);
  assert.match(offlineBoundary, /offline Agent Chat transcript product/);
  assert.match(draftBoundary, /Agent Chat draft persistence/);
  assert.match(draftBoundary, /Keep drafts transient/);
  assert.match(metadataBoundary, /rename, archive, or user-authored conversation-title metadata/);
  assert.match(conversationPosture, /one active Runtime conversation per runtime source snapshot/);
  assert.match(projectionTruth, /Runtime session snapshots/);
  assert.match(projectionTruth, /runtime\.agent\.turn\.\*/);
  assert.match(retiredStore, /steady-state chat_agent_\* store, bridge client, or command family/);
});

test('Agent Chat store cutover is closed by Runtime and SDK replacement coverage', () => {
  const desktopSpec = readWorkspaceFile('.nimi/spec/canonical/desktop/agent-projection.authority.yaml');
  const runtimeSpec = readWorkspaceFile('docs/authority/runtime-agent-service-rationale.md');
  const retiredStore = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r026');
  const summaries = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r028');
  const snapshotRecovery = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r029');
  const draftBoundary = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r023');
  const historyMutation = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r030');
  const messageMutation = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r031');
  const conversationPosture = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r025');
  const optimisticProjection = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r032');
  const offlineBoundary = readAuthorityUnit(desktopSpec, 'rule.nimi.desktop.agent-projection.r022');

  assert.match(retiredStore, /Retired chat_agent store stays absent/);
  assert.match(retiredStore, /chat_agent_\* Tauri commands/);
  assert.match(retiredStore, /chatAgentStoreClient/);
  assert.match(retiredStore, /SQLite schema/);
  assert.match(summaries, /calling app Agent Chat conversation summaries/);
  assert.match(summaries, /without reading Desktop SQLite/);
  assert.match(snapshotRecovery, /ConversationAnchor and GetPublicChatSessionSnapshot/);
  assert.match(snapshotRecovery, /stable message identity, timestamps, status, and kind/);
  assert.match(draftBoundary, /draft persistence as a replacement for the retired Desktop draft behavior/);
  assert.match(historyMutation, /close, delete, or clear policy is owned by Runtime or SDK/);
  assert.match(messageMutation, /message-level delete or redact policy is owned by Runtime or SDK/);
  assert.match(conversationPosture, /one active Runtime conversation per runtime source snapshot/);
  assert.match(conversationPosture, /LocalAgent projection/);
  assert.match(optimisticProjection, /in-memory optimistic projection/);
  assert.match(optimisticProjection, /Runtime session snapshots or runtime\.agent\.turn\.\*/);
  assert.match(offlineBoundary, /offline Agent Chat transcript product/);

  assert.match(runtimeSpec, /K-AGCORE-006a/);
  assert.match(runtimeSpec, /conversation summary listing scoped to the authenticated calling app/);
  assert.match(runtimeSpec, /close \/ delete \/ clear policy/);
  assert.match(runtimeSpec, /message-level delete \/ redact policy/);
  assert.match(runtimeSpec, /explicit rejection of Agent Chat draft persistence/);
  assert.match(runtimeSpec, /do not admit Desktop-local transcript/);
});

test('Runtime admits Agent Chat conversation summaries before store cutover implementation', () => {
  const runtimeSpec = readWorkspaceFile('docs/authority/runtime-agent-service-rationale.md');
  const rpcMethods = readWorkspaceFile('config/runtime-rpc-methods.yaml');
  const sdkMethods = readWorkspaceFile('config/sdks-runtime-method-groups.yaml');

  assert.match(runtimeSpec, /K-AGCORE-006b/);
  assert.match(runtimeSpec, /ListAgentConversationSummaries/);
  assert.match(runtimeSpec, /derived\s+presentation text/);
  assert.match(runtimeSpec, /does not admit close, delete, clear, archive, rename, draft, or/);
  assert.match(runtimeSpec, /rename and archive are not product surfaces/);
  assert.match(runtimeSpec, /one active Agent Chat conversation per runtime source/);
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

  assert.match(adapter, /createNimiRuntimeAgentConsumeClient/);
  assert.match(adapter, /sdk\.accountProduct\(\)\.agents/);
  assert.match(adapter, /sdk\.appId\(\)/);
  assert.match(adapter, /anchors\.listSummaries/);
  assert.match(adapter, /statusFilter:\s*\['active'\]/);
  assert.match(adapter, /export type AgentRuntimeConversationSummary/);
  assert.doesNotMatch(adapter, /getPlatformClient/);
  assert.doesNotMatch(adapter, /runtime\.agent\.anchors\.listSummaries/);
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
  assert.doesNotMatch(state, /chatAgentStoreClient|getThreadBundle|remediationBundleQuery/);

  const core = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-core.ts',
  );
  const effects = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-effects.ts',
  );
  const snapshotHydration = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-session-snapshot.ts',
  );
  assert.doesNotMatch(core, /THREADS_QUERY_KEY|upsertThreadSummary/);
  assert.doesNotMatch(effects, /setThreadsCache|THREADS_QUERY_KEY|upsertThreadSummary/);
  assert.doesNotMatch(snapshotHydration, /THREADS_QUERY_KEY|upsertThreadSummary/);
});

test('Runtime Agent conversation summary adapter keeps Runtime anchor identity explicit', () => {
  const target: AgentLocalTargetSnapshot = {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
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
      runtimeSourceRef: 'agent-1',
      createdAt: { seconds: '1700000000', nanos: 0 },
      updatedAt: { seconds: '1700000001', nanos: 250000000 },
    },
    title: 'Runtime title',
    lastMessageRole: 'assistant',
    lastMessageText: 'Hello from Runtime',
    lastMessageId: 'msg-summary',
    transcriptMessageCount: 2,
    updatedAt: { seconds: '1700000002', nanos: 500000000 },
  });

  assert.equal(summary?.conversationAnchorId, 'anchor-1');
  assert.equal(summary?.localAgentRef, target.localAgentRef);
  assert.equal(summary?.lastMessageId, 'msg-summary');
  assert.equal(summary?.updatedAtMs, 1700000002500);
  assert.equal(summary?.targetSnapshot, target);
});

test('Desktop command classification no longer admits chat_agent store commands', () => {
  const table = readWorkspaceFile('config/desktop-command-execution-classification.yaml');

  assert.doesNotMatch(table, /memory_embedding_runtime_(?:inspect|request_bind|request_cutover)/);
  assert.match(table, /family: chat_ai_local_store[\s\S]*?regex: "\^chat_ai_\.\*\$"[\s\S]*?remediation_required: false/);
  assert.doesNotMatch(table, /chat_agent_projection_cache_migration|chat_agent_\.\*/);
});

test('Desktop projection cache store bridge is hard-cut', () => {
  const bootstrap = readWorkspaceFile('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
  const main = readWorkspaceFile('apps/desktop/src-tauri/src/main.rs');
  const runtimeProvider = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-provider.ts',
  );
  const adapterState = readWorkspaceFile(
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts',
  );

  assert.equal(workspacePathExists('apps/desktop/src-tauri/src/chat_agent_store/commands.rs'), false);
  assert.equal(workspacePathExists('apps/desktop/src-tauri/src/chat_agent_store/mod.rs'), false);
  assert.equal(workspacePathExists('apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-store.ts'), false);
  assert.doesNotMatch(main, /mod chat_agent_store/);
  assert.doesNotMatch(bootstrap, /chat_agent_store|chat_agent_/);
  assert.doesNotMatch(adapterState, /chatAgentStoreClient|getThreadBundle|remediationBundleQuery/);
  assert.doesNotMatch(runtimeProvider, /chat-agent-continuity|commitProviderOutcome|createAgentLocalChatContinuityAdapter/);
  assert.doesNotMatch(runtimeProvider, /chatAgentStoreClient\.commitTurnResult/);
});

