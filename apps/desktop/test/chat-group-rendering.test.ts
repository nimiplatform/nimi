import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { groupMessageToCanonical } from '../src/shell/renderer/features/chat/chat-group-thread-model';

const desktopRoot = path.join(import.meta.dirname, '..');
const workspaceRoot = path.join(import.meta.dirname, '..', '..', '..');

function readWorkspaceFile(relativePath: string): string {
  const desktopScopedPath = path.join(desktopRoot, relativePath);
  if (fs.existsSync(desktopScopedPath)) {
    return fs.readFileSync(desktopScopedPath, 'utf8');
  }
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}

test('groupMessageToCanonical maps current user, other human, and agent into distinct canonical roles', () => {
  const currentUserMessage = groupMessageToCanonical({
    id: 'msg_self',
    chatId: 'chat_1',
    senderId: 'user_self',
    text: 'hello',
    payload: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    editedAt: null,
    author: {
      type: 'human',
      accountId: 'user_self',
      displayName: 'Halliday',
      avatarUrl: null,
      agentOwnerId: null,
    },
  } as never, 'user_self');
  assert.equal(currentUserMessage.role, 'user');

  const otherHumanMessage = groupMessageToCanonical({
    id: 'msg_other',
    chatId: 'chat_1',
    senderId: 'user_other',
    text: 'hi there',
    payload: null,
    createdAt: '2026-04-15T00:01:00.000Z',
    editedAt: null,
    author: {
      type: 'human',
      accountId: 'user_other',
      displayName: 'Amber',
      avatarUrl: null,
      agentOwnerId: null,
    },
  } as never, 'user_self');
  assert.equal(otherHumanMessage.role, 'assistant');
  assert.equal(otherHumanMessage.senderKind, 'human');

  const agentMessage = groupMessageToCanonical({
    id: 'msg_agent',
    chatId: 'chat_1',
    senderId: 'agent_1',
    text: 'I can help.',
    payload: null,
    createdAt: '2026-04-15T00:02:00.000Z',
    editedAt: null,
    author: {
      type: 'agent',
      accountId: 'agent_1',
      displayName: 'CuiCui',
      avatarUrl: 'https://example.com/agent.png',
      agentOwnerId: 'user_self',
    },
  } as never, 'user_self');
  assert.equal(agentMessage.role, 'agent');
  assert.equal(agentMessage.senderKind, 'agent');
});

test('group rendering wires avatar renderers and sender labels through transcript and stage surfaces', () => {
  const groupModeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-mode-content.tsx');
  const transcriptSource = readWorkspaceFile('kit/features/chat/src/components/canonical-transcript-view.tsx');
  const canonicalComponentsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-canonical-components.tsx');

  assert.match(groupModeSource, /const transcriptProps = useGroupCanonicalTranscriptProps\(\);/);
  assert.match(groupModeSource, /const stagePanelProps = useGroupCanonicalStagePanelProps\(\);/);
  assert.match(groupModeSource, /transcriptProps=\{transcriptProps\}/);
  assert.match(groupModeSource, /stagePanelProps=\{stagePanelProps\}/);
  assert.match(transcriptSource, /const renderedAvatar = props\.renderMessageAvatar\?\.\(virtualItem\.item\.message, renderContext\);/);
  assert.match(transcriptSource, /const showSenderLabel = virtualItem\.item\.message\.source === 'group'/);
  assert.match(transcriptSource, /virtualItem\.item\.isGroupStart/);
  assert.match(transcriptSource, /className=\{cn\(/);
  assert.match(transcriptSource, /pl-10 text-\[11px\] font-medium tracking-\[0\.01em\]/);
  assert.match(transcriptSource, /showAvatar=\{Boolean\(renderedAvatar\) && virtualItem\.item\.showAvatar\}/);
  assert.match(canonicalComponentsSource, /EntityAvatar/);
  assert.match(canonicalComponentsSource, /kind=\{senderKind\}/);
});
