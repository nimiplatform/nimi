import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ConversationCanonicalMessage,
  ConversationCharacterData,
  ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { resolveAgentConversationHostSnapshot } from '../src/shell/renderer/features/chat/chat-agent-shell-host-snapshot.js';

function targetSummaries(): ConversationTargetSummary[] {
  return [{
    id: 'agent-1',
    source: 'agent',
    canonicalSessionId: 'thread-1',
    title: 'Companion',
    handle: '@companion',
    bio: 'friend agent',
    avatarUrl: null,
    avatarFallback: 'C',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active',
    isOnline: null,
    metadata: {},
  }];
}

function canonicalMessages(): ConversationCanonicalMessage[] {
  return [{
    id: 'user-1',
    sessionId: 'thread-1',
    targetId: 'agent-1',
    source: 'agent',
    role: 'user',
    text: 'hello',
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
    status: 'complete',
    kind: 'text',
    senderName: 'You',
    senderKind: 'human',
    metadata: {},
  }, {
    id: 'assistant-1',
    sessionId: 'thread-1',
    targetId: 'agent-1',
    source: 'agent',
    role: 'assistant',
    text: 'hi there',
    createdAt: '2026-04-05T00:00:01.000Z',
    updatedAt: '2026-04-05T00:00:02.000Z',
    status: 'complete',
    kind: 'text',
    senderName: 'Companion',
    senderKind: 'agent',
    metadata: {
      reasoningText: 'thinking',
    },
  }];
}

function characterData(): ConversationCharacterData {
  return {
    name: 'Companion',
    avatarUrl: null,
    avatarFallback: 'C',
    handle: '@companion',
    bio: 'friend agent',
    interactionState: {
      phase: 'thinking',
      busy: true,
    },
  };
}

test('agent host snapshot keeps shell-facing availability, selection, messages, and character data aligned', () => {
  const snapshot = resolveAgentConversationHostSnapshot({
    activeThreadId: 'thread-1',
    targets: targetSummaries(),
    selectedTargetId: 'agent-1',
    messages: canonicalMessages(),
    characterData: characterData(),
    hostView: {
      availability: {
        mode: 'agent',
        label: 'Agent',
        enabled: true,
        badge: 1,
        disabledReason: null,
      },
      transcriptProps: {
        loading: false,
        error: null,
        emptyEyebrow: 'Agent',
        emptyTitle: 'Start the local agent conversation',
        emptyDescription: 'Send a message to start the local agent conversation.',
        loadingLabel: 'Loading local agent conversation…',
        footerContent: null,
        renderMessageContent: () => null,
        pendingFirstBeat: false,
      },
      stagePanelProps: {
        footerContent: null,
        renderMessageContent: () => null,
        pendingFirstBeat: false,
      },
    },
  });

  assert.equal(snapshot.mode, 'agent');
  assert.equal(snapshot.activeThreadId, 'thread-1');
  assert.equal(snapshot.availability.badge, 1);
  assert.equal(snapshot.selectedTargetId, 'agent-1');
  assert.equal(snapshot.targets?.[0]?.canonicalSessionId, 'thread-1');
  assert.equal(snapshot.messages?.[1]?.senderName, 'Companion');
  assert.equal(snapshot.characterData?.interactionState?.phase, 'thinking');
  assert.equal(snapshot.transcriptProps?.pendingFirstBeat, false);
  assert.equal(snapshot.stagePanelProps?.pendingFirstBeat, false);
});
