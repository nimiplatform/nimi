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

test('group agent slot controls require Realm admin projection at visibility and handler layers', () => {
  assert.match(participantPanelSource, /const canManageAgentSlots = Boolean\(/);
  assert.match(participantPanelSource, /humans\.some\(\(p\) => p\.accountId === currentUserId && p\.role === 'admin'\)/);
  assert.match(participantPanelSource, /const showAddAgentPicker = addAgentOpen && canManageAgentSlots;/);
  assert.match(participantPanelSource, /enabled: showAddAgentPicker,/);
  assert.match(participantPanelSource, /if \(addAgentOpen && !canManageAgentSlots\) \{\s*setAddAgentOpen\(false\);/s);
  assert.match(participantPanelSource, /\{showAddAgentPicker && \(/);
  assert.match(participantPanelSource, /if \(!canManageAgentSlots\) \{\s*setPanelError\(t\('Chat\.groupAgentSlotManagementDenied'/s);
  assert.match(participantPanelSource, /data-chat-group-agent-slot-refusal="realm-role-required"/);
  assert.doesNotMatch(participantPanelSource, /agentOwnerId\s*===\s*currentUserId/);
  assert.doesNotMatch(participantPanelSource, /canManageAgentSlots[\s\S]{0,240}agentOwnerId/);
});

test('group composer mention surface is text insertion posture only', () => {
  assert.match(composerSource, /data-chat-group-mention-posture="text-insertion-only"/);
  assert.match(composerSource, /applyGroupAgentMentionSelection/);
  assert.doesNotMatch(composerSource, /sendGroupAgentMessage/);
  assert.doesNotMatch(composerSource, /sendGroupAgentChatMessage/);
  assert.doesNotMatch(composerSource, /detectGroupAgentTriggers|TRIGGER_RECENCY_WINDOW_MS|triggerText/);
  assert.doesNotMatch(composerSource, /chat-agent-orchestration|chat-agent-continuity|chat-agent-runtime-memory/);
});

test('group adapter feeds committed Realm agent slots into split candidate handoff', () => {
  assert.match(groupAdapterSource, /const participants: GroupParticipantDto\[] = selectedGroup\?\.participants \|\| \[];/);
  assert.match(groupAdapterSource, /<ChatGroupComposer[\s\S]*agentParticipants=\{participants\}/);
  assert.match(groupAdapterSource, /dataSync\.sendGroupMessage\(chatId, content\)/);
  assert.match(groupAdapterSource, /resolveInvokableGroupAgentMention/);
  assert.match(groupAdapterSource, /normalizeText\(participant\.agentOwnerId\) === userId/);
  assert.match(groupAdapterSource, /dataSync\.commitRealmGroupMessageCandidate/);
  assert.doesNotMatch(groupAdapterSource, /sendGroupAgentMessage|sendGroupAgentChatMessage/);
  assert.doesNotMatch(groupAdapterSource, /candidate output|runtime\.orchestration|GROUP_LIMITED/);
});

test('group control surface does not expose fake agent thinking copy', () => {
  assert.doesNotMatch(enChatLocale, /groupAgentThinking|Agent is thinking/);
  assert.doesNotMatch(zhChatLocale, /groupAgentThinking|智能体正在思考/);
  assert.match(enChatLocale, /"groupAgentSlotManagementDenied": "Only group admins can manage agents\."/);
  assert.match(zhChatLocale, /"groupAgentSlotManagementDenied": "只有群组管理员可以管理智能体。"/);
});
