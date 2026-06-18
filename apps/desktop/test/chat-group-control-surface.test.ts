import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const createModalSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-create-modal.tsx');
const createControllerSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-create-controller.tsx');
const composerSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-composer.tsx');
const participantPanelSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-participant-panel.tsx');
const groupAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-adapter.tsx');
const enChatLocale = readWorkspaceFile('src/shell/renderer/locales/en/12-Chat.json');
const zhChatLocale = readWorkspaceFile('src/shell/renderer/locales/zh/12-Chat.json');

test('group create modal reports real create failures without closing or navigating first', () => {
  assert.match(createModalSource, /const \[createError, setCreateError\] = useState<string \| null>\(null\);/);
  assert.match(createModalSource, /try \{\s*await onCreateGroup\(normalizedTitle, \[\.\.\.selectedIds\]\);\s*\} catch \(error\) \{/s);
  assert.match(createModalSource, /setCreateError\(message\);/);
  assert.match(createModalSource, /Chat\.createGroupError/);
  assert.doesNotMatch(createModalSource, /catch \(error\)[\s\S]{0,220}onClose\(\)/);
  assert.match(createControllerSource, /const newId = resolveCreatedGroupId\(result\);/);
  assert.match(createControllerSource, /setSelectedTargetForSource\('group', newId\);/);
});

test('group source slot controls require Realm admin projection at visibility and handler layers', () => {
  assert.match(participantPanelSource, /const canManageSourceSlots = Boolean\(/);
  assert.match(participantPanelSource, /humans\.some\(\(p\) => p\.accountId === currentUserId && p\.role === 'admin'\)/);
  assert.match(participantPanelSource, /const showAddSourcePicker = addSourceOpen && canManageSourceSlots;/);
  assert.match(participantPanelSource, /enabled: showAddSourcePicker,/);
  assert.match(participantPanelSource, /if \(addSourceOpen && !canManageSourceSlots\) \{\s*setAddSourceOpen\(false\);/s);
  assert.match(participantPanelSource, /\{showAddSourcePicker && \(/);
  assert.match(participantPanelSource, /if \(!canManageSourceSlots\) \{\s*setPanelError\(t\('Chat\.groupSourceSlotManagementDenied'/s);
  assert.match(participantPanelSource, /data-chat-runtime-participant-slot-refusal="realm-role-required"/);
  assert.doesNotMatch(participantPanelSource, /sourceOwnerId\s*===\s*currentUserId/);
  assert.doesNotMatch(participantPanelSource, /canManageSourceSlots[\s\S]{0,240}sourceOwnerId/);
});

test('group composer mention surface is text insertion posture only', () => {
  assert.match(composerSource, /CanonicalComposer/);
  assert.match(composerSource, /data-chat-group-mention-posture="text-insertion-only"/);
  assert.match(composerSource, /applyGroupSourceMentionSelection/);
  assert.doesNotMatch(composerSource, /ConversationComposerShell/);
  assert.doesNotMatch(composerSource, /sendGroupSourceMessage/);
  assert.doesNotMatch(composerSource, /sendGroupSourceChatMessage/);
  assert.doesNotMatch(composerSource, /detectGroupSourceTriggers|TRIGGER_RECENCY_WINDOW_MS|triggerText/);
  assert.doesNotMatch(composerSource, /chat-source-orchestration|chat-source-continuity|chat-source-runtime-memory/);
});

test('group adapter feeds committed runtime source slots into split candidate handoff', () => {
  assert.match(groupAdapterSource, /const participants: readonly GroupParticipantDto\[] = selectedGroup\?\.participants \|\| \[];/);
  assert.match(groupAdapterSource, /composerAdapter:\s*null/);
  assert.doesNotMatch(groupAdapterSource, /submit:\s*async\s*\(\)\s*=>\s*undefined/);
  assert.match(groupAdapterSource, /<ChatGroupComposer[\s\S]*sourceParticipants=\{participants\}/);
  assert.match(groupAdapterSource, /realmGroupChatData\.sendGroupMessage\(chatId, content\)/);
  assert.match(groupAdapterSource, /resolveInvokableGroupSourceMention/);
  assert.match(groupAdapterSource, /normalizeText\(participant\.sourceOwnerId\) === userId/);
  assert.match(groupAdapterSource, /realmGroupChatData\.commitRealmGroupSourceMessageCandidate/);
  assert.doesNotMatch(groupAdapterSource, /sendGroupSourceMessage|sendGroupSourceChatMessage/);
  assert.doesNotMatch(groupAdapterSource, /candidate output|runtime\.orchestration|GROUP_LIMITED/);
});

test('group control surface does not expose fake source thinking copy', () => {
  assert.doesNotMatch(enChatLocale, /groupSourceThinking|Source is thinking/);
  assert.doesNotMatch(zhChatLocale, /groupSourceThinking|智能体正在思考/);
  assert.match(enChatLocale, /"groupSourceSlotManagementDenied": "Only group admins can manage sources\."/);
  assert.match(zhChatLocale, /"groupSourceSlotManagementDenied": "只有群组管理员可以管理 Source。"/);
});
