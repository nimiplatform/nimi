import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import type { ConversationCanonicalMessage, ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { resolveAgentConversationHostView } from '../src/shell/renderer/features/chat/chat-agent-shell-host-view.js';

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
  }, {
    id: 'agent-2',
    source: 'agent',
    canonicalSessionId: 'agent-2',
    title: 'Scout',
    handle: '@scout',
    bio: null,
    avatarUrl: null,
    avatarFallback: 'S',
    previewText: null,
    updatedAt: null,
    unreadCount: 0,
    status: 'active',
    isOnline: null,
    metadata: {},
  }];
}

function renderMessageContent(message: ConversationCanonicalMessage) {
  return <span data-kind={message.kind || 'text'}>{message.text}</span>;
}

test('agent host view resolves availability badge and selected target id from shell-facing state', () => {
  const hostView = resolveAgentConversationHostView({
    threads: targetSummaries(),
    selectedTargetId: 'agent-1',
    loading: false,
    error: null,
    footerViewState: {
      displayState: 'hidden',
      pendingFirstBeat: false,
    },
    footerContent: null,
    labels: {
      emptyEyebrow: 'Agent',
      emptyTitle: 'Start the local agent conversation',
      emptyDescription: 'Send a message to start the local agent conversation.',
      loadingLabel: 'Loading local agent conversation…',
      pendingAgentRoleLabel: 'Agent is replying',
      pendingThinkingLabel: 'Thinking...',
      pendingStopLabel: 'Stop generating',
      todayLabel: 'Today',
      yesterdayLabel: 'Yesterday',
    },
    renderMessageContent,
  });

  assert.equal(hostView.availability.badge, 2);
  assert.equal(hostView.selectedTargetId, 'agent-1');
  assert.equal(hostView.transcriptProps?.footerContent, null);
  assert.equal(hostView.stagePanelProps?.footerContent, null);
  assert.equal(hostView.transcriptProps?.disableRpContent, true);
  assert.equal(hostView.stagePanelProps?.disableRpContent, true);
});

test('agent host view renders streaming footer and propagates pendingFirstBeat to transcript and stage props', () => {
  const hostView = resolveAgentConversationHostView({
    threads: targetSummaries(),
    selectedTargetId: 'agent-1',
    loading: false,
    error: null,
    footerViewState: {
      displayState: 'streaming',
      pendingFirstBeat: true,
    },
    footerContent: <span data-testid="footer-streaming">Stop generating</span>,
    labels: {
      emptyEyebrow: 'Agent',
      emptyTitle: 'Start the local agent conversation',
      emptyDescription: 'Send a message to start the local agent conversation.',
      loadingLabel: 'Loading local agent conversation…',
      pendingAgentRoleLabel: '伙伴正在回复',
      pendingThinkingLabel: '正在思考...',
      pendingStopLabel: '停止生成',
      todayLabel: '今天',
      yesterdayLabel: '昨天',
    },
    renderMessageContent,
  });

  assert.equal(hostView.transcriptProps?.pendingFirstBeat, true);
  assert.equal(hostView.stagePanelProps?.pendingFirstBeat, true);
  assert.equal(hostView.transcriptProps?.pendingAgentRoleLabel, '伙伴正在回复');
  assert.equal(hostView.transcriptProps?.pendingThinkingLabel, '正在思考...');
  assert.equal(hostView.transcriptProps?.pendingStopLabel, '停止生成');
  assert.equal(hostView.stagePanelProps?.pendingAgentRoleLabel, '伙伴正在回复');
  assert.equal(hostView.stagePanelProps?.pendingThinkingLabel, '正在思考...');
  assert.equal(hostView.transcriptProps?.formatDateLabel?.({
    timestamp: new Date().toISOString(),
    date: new Date(),
    diffDays: 0,
  }), '今天');
  assert.equal(hostView.transcriptProps?.formatDateLabel?.({
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    date: new Date(Date.now() - 86400000),
    diffDays: 1,
  }), '昨天');
  assert.ok(React.isValidElement(hostView.transcriptProps?.footerContent));
  assert.ok(React.isValidElement(hostView.stagePanelProps?.footerContent));
  assert.equal(hostView.transcriptProps?.footerContent.props['data-testid'], 'footer-streaming');
  assert.equal(hostView.stagePanelProps?.footerContent.props['data-testid'], 'footer-streaming');
});

test('agent host view renders interrupted footer copy when the footer state is interrupted', () => {
  const hostView = resolveAgentConversationHostView({
    threads: targetSummaries(),
    selectedTargetId: 'agent-1',
    loading: false,
    error: null,
    footerViewState: {
      displayState: 'interrupted',
      pendingFirstBeat: false,
    },
    footerContent: <span data-testid="footer-interrupted">Response interrupted</span>,
    labels: {
      emptyEyebrow: 'Agent',
      emptyTitle: 'Start the local agent conversation',
      emptyDescription: 'Send a message to start the local agent conversation.',
      loadingLabel: 'Loading local agent conversation…',
      pendingAgentRoleLabel: 'Agent is replying',
      pendingThinkingLabel: 'Thinking...',
      pendingStopLabel: 'Stop generating',
      todayLabel: 'Today',
      yesterdayLabel: 'Yesterday',
    },
    renderMessageContent,
  });

  assert.ok(React.isValidElement(hostView.transcriptProps?.footerContent));
  assert.equal(hostView.transcriptProps?.footerContent.props['data-testid'], 'footer-interrupted');
});
