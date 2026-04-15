import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatContactsSidebarSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-contacts-sidebar.tsx');
const chatGroupFlowConstantsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-flow-constants.ts');
const chatGroupModeContentSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-mode-content.tsx');
const chatGroupCreateModalSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-create-modal.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');

test('group first-run flow: contact rail exposes a persistent create-group action', () => {
  assert.match(e2eIdsSource, /chatCreateGroupButton: 'chat-create-group-button'/);
  assert.match(chatContactsSidebarSource, /onCreateGroup\?: \(\) => void;/);
  assert.match(chatContactsSidebarSource, /data-testid=\{E2E_IDS\.chatCreateGroupButton\}/);
  assert.match(chatContactsSidebarSource, /onClick=\{onCreateGroup\}/);
});

test('group first-run flow: chat page routes create-group into group mode intent', () => {
  assert.match(chatGroupFlowConstantsSource, /GROUP_CREATE_INTENT_TARGET_ID = 'group:create'/);
  assert.match(chatPageSource, /if \(chatMode === 'group' && storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID\)/);
  assert.match(chatPageSource, /setChatMode\('group'\)/);
  assert.match(chatPageSource, /setSelectedTargetForSource\('group', GROUP_CREATE_INTENT_TARGET_ID\)/);
  assert.match(chatPageSource, /onCreateGroup=\{handleCreateGroup\}/);
});

test('group first-run flow: group mode consumes create intent and opens create modal', () => {
  assert.match(chatGroupModeContentSource, /GROUP_CREATE_INTENT_TARGET_ID/);
  assert.match(chatGroupModeContentSource, /storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID/);
  assert.match(chatGroupModeContentSource, /setSelectedTargetForSource\('group', null\)/);
  assert.match(chatGroupModeContentSource, /void hostOnCreateThread\?\.\(\)/);
});

test('group first-run flow: create modal fails closed on empty title before POST', () => {
  assert.match(chatGroupCreateModalSource, /const normalizedTitle = title\.trim\(\);/);
  assert.match(chatGroupCreateModalSource, /const titleMissing = normalizedTitle\.length === 0;/);
  assert.match(chatGroupCreateModalSource, /if \(titleMissing \|\| selectedIds\.size < 1 \|\| isCreating\) return;/);
  assert.match(chatGroupCreateModalSource, /await onCreateGroup\(normalizedTitle, \[\.\.\.selectedIds\]\);/);
  assert.match(chatGroupCreateModalSource, /disabled=\{createDisabled\}/);
});

test('group first-run flow: host selection only syncs to store after sidebar target exists', () => {
  assert.match(chatGroupModeContentSource, /const hostSelectedTargetExists = useMemo\(/);
  assert.match(chatGroupModeContentSource, /allTargets\.some\(\(target\) => target\.id === host\.selectedTargetId\)/);
  assert.match(chatGroupModeContentSource, /if \(!host\.selectedTargetId \|\| storeSelectedTargetId \|\| !hostSelectedTargetExists\) return;/);
});
