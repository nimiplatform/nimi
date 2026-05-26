import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatRelationshipRailSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-relationship-rail.tsx');
const chatGroupAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-adapter.tsx');
const chatGroupModeContentSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-mode-content.tsx');
const chatGroupCreateModalSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-create-modal.tsx');
const chatGroupCreateControllerSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-create-controller.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');

test('group first-run flow: relationship rail exposes a persistent create-group action', () => {
  assert.match(e2eIdsSource, /chatCreateGroupButton: 'chat-create-group-button'/);
  assert.match(chatRelationshipRailSource, /onCreateGroup\?: \(\) => void;/);
  assert.match(chatRelationshipRailSource, /data-testid=\{E2E_IDS\.chatCreateGroupButton\}/);
  assert.match(chatRelationshipRailSource, /onClick=\{onCreateGroup\}/);
});

test('group first-run flow: chat page opens the create-group modal without mutating chat mode or selection', () => {
  assert.match(chatPageSource, /import \{ useChatGroupCreateController \} from '\.\/chat-group-create-controller';/);
  assert.match(chatPageSource, /const groupCreateController = useChatGroupCreateController\(\);/);
  assert.match(chatPageSource, /const handleCreateGroup = useCallback\(\(\) => \{\s*groupCreateController\.open\(\);\s*\}, \[groupCreateController\]\);/);
  assert.match(chatPageSource, /\{groupCreateController\.modal\}/);
  assert.match(chatPageSource, /onCreateGroup=\{handleCreateGroup\}/);
  assert.doesNotMatch(chatPageSource, /GROUP_CREATE_INTENT_TARGET_ID/);
  assert.doesNotMatch(chatPageSource, /chat-group-flow-constants/);
  assert.doesNotMatch(chatPageSource, /handleCreateGroup[\s\S]{0,200}setChatMode\('group'\)/);
  assert.doesNotMatch(chatPageSource, /handleCreateGroup[\s\S]{0,200}setSelectedTargetForSource\('group'/);
});

test('group create controller fails closed on contract violation and routes to new group on success', () => {
  assert.match(chatGroupCreateControllerSource, /import \{ ChatGroupCreateModal \} from '\.\/chat-group-create-modal';/);
  assert.match(chatGroupCreateControllerSource, /const setChatMode = useAppStore\(\(state\) => state\.setChatMode\);/);
  assert.match(chatGroupCreateControllerSource, /const setSelectedTargetForSource = useAppStore\(\(state\) => state\.setSelectedTargetForSource\);/);
  assert.match(chatGroupCreateControllerSource, /const result = await dataSync\.createGroup\(title, participantIds\);/);
  assert.match(chatGroupCreateControllerSource, /throw new Error\('chat-group-create:contract-violation:missing-id'\);/);
  assert.match(chatGroupCreateControllerSource, /typeof rawId !== 'string'/);
  assert.match(chatGroupCreateControllerSource, /throw new Error\('chat-group-create:contract-violation:invalid-id'\);/);
  assert.match(chatGroupCreateControllerSource, /const newId = rawId\.trim\(\);/);
  assert.match(chatGroupCreateControllerSource, /throw new Error\('chat-group-create:contract-violation:empty-id'\);/);
  assert.match(chatGroupCreateControllerSource, /setChatMode\('group'\);\s*setSelectedTargetForSource\('group', newId\);/);
  assert.match(chatGroupCreateControllerSource, /<ChatGroupCreateModal\s+open=\{isOpen\}\s+onClose=\{close\}\s+onCreateGroup=\{handleCreateGroup\}\s*\/>/);
});

test('group create controller validates created group id before success projection', () => {
  const createCall = chatGroupCreateControllerSource.indexOf('const result = await dataSync.createGroup(title, participantIds);');
  const idValidation = chatGroupCreateControllerSource.indexOf('const newId = resolveCreatedGroupId(result);');
  const modeSelection = chatGroupCreateControllerSource.indexOf("setSelectedTargetForSource('group', newId);");
  const invalidation = chatGroupCreateControllerSource.indexOf('void queryClient.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });');
  const modalClose = chatGroupCreateControllerSource.indexOf('setIsOpen(false);', idValidation);

  assert.ok(createCall >= 0);
  assert.ok(idValidation > createCall);
  assert.ok(modeSelection > idValidation);
  assert.ok(invalidation > idValidation);
  assert.ok(modalClose > idValidation);
});

test('group first-run flow: group mode content no longer carries sentinel intent routing', () => {
  assert.doesNotMatch(chatGroupModeContentSource, /GROUP_CREATE_INTENT_TARGET_ID/);
  assert.doesNotMatch(chatGroupModeContentSource, /chat-group-flow-constants/);
  assert.doesNotMatch(chatGroupModeContentSource, /onCreateThread/);
  assert.doesNotMatch(chatGroupModeContentSource, /normalizedStoreSelectedTargetId/);
  assert.doesNotMatch(chatGroupModeContentSource, /prevTargetIdRef/);
  assert.match(chatGroupModeContentSource, /const selectedTargetId = storeSelectedTargetId;/);
});

test('group first-run flow: create modal fails closed on empty title before POST', () => {
  assert.match(chatGroupCreateModalSource, /const normalizedTitle = title\.trim\(\);/);
  assert.match(chatGroupCreateModalSource, /const titleMissing = normalizedTitle\.length === 0;/);
  assert.match(chatGroupCreateModalSource, /if \(titleMissing \|\| selectedIds\.size < 1 \|\| isCreating\) return;/);
  assert.match(chatGroupCreateModalSource, /await onCreateGroup\(normalizedTitle, \[\.\.\.selectedIds\]\);/);
  assert.match(chatGroupCreateModalSource, /disabled=\{createDisabled\}/);
});

test('group first-run flow: group selection restores from last real thread when the store has no current selection', () => {
  assert.match(chatGroupModeContentSource, /const lastSelectedGroupThread = useAppStore\(\(state\) => state\.lastSelectedThreadByMode\.group \?\? null\)/);
  assert.match(chatGroupModeContentSource, /const restoreAttemptedRef = useRef\(false\);/);
  assert.match(chatGroupModeContentSource, /if \(restoreAttemptedRef\.current \|\| allTargets\.length === 0\)/);
  assert.match(chatGroupModeContentSource, /if \(storeSelectedTargetId \|\| !lastSelectedGroupThread\)/);
  assert.match(chatGroupModeContentSource, /setSelectedTargetForSource\('group', lastSelectedGroupThread\)/);
  assert.match(chatGroupModeContentSource, /target\.id === lastSelectedGroupThread && target\.source === 'group'/);
});

test('group first-run flow: adapter derives selection straight from the store and persists last selected as the restore source of truth', () => {
  assert.match(chatGroupAdapterSource, /const setLastSelectedThreadForMode = useAppStore\(\(state\) => state\.setLastSelectedThreadForMode\)/);
  assert.match(chatGroupAdapterSource, /const storeSelectedTargetId = useAppStore\(\(state\) => state\.selectedTargetBySource\.group \?\? null\);/);
  assert.match(chatGroupAdapterSource, /const selectedGroupId = storeSelectedTargetId;/);
  assert.match(chatGroupAdapterSource, /if \(!selectedGroupId\) \{\s*return;\s*\}\s*setLastSelectedThreadForMode\('group', selectedGroupId\);/s);
  assert.doesNotMatch(chatGroupAdapterSource, /GROUP_CREATE_INTENT_TARGET_ID/);
  assert.doesNotMatch(chatGroupAdapterSource, /chat-group-flow-constants/);
  assert.doesNotMatch(chatGroupAdapterSource, /ChatGroupCreateModal/);
  assert.doesNotMatch(chatGroupAdapterSource, /createModalOpen/);
  assert.doesNotMatch(chatGroupAdapterSource, /onCreateThread/);
  assert.doesNotMatch(chatGroupAdapterSource, /auxiliaryOverlayContent/);
});
