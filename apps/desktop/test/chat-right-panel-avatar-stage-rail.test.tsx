import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';

import {
  ChatRightPanelAvatarStageRail,
  resolveChatAgentAvatarLive2dDiagnosticPanelModel,
} from '../src/shell/renderer/features/chat/chat-right-panel-avatar-stage-rail.js';
import {
  ChatRightPanelUtilityRail,
} from '../src/shell/renderer/features/chat/chat-right-panel-character-rail.js';
import {
  desktopAgentAvatarBindingQueryKey,
  desktopAgentAvatarResourcesQueryKey,
} from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-store.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

test('avatar stage rail renders standalone primary, status, and settings cards around a single stage viewport', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatRightPanelAvatarStageRail
          selectedTarget={{
            id: 'agent-1',
            source: 'agent',
            canonicalSessionId: 'thread-1',
            title: 'Companion',
            handle: '@companion',
            bio: 'friend agent',
            avatarUrl: 'https://cdn.nimi.test/companion.png',
            avatarFallback: 'C',
            previewText: null,
            updatedAt: null,
            unreadCount: 0,
            status: 'active',
            isOnline: null,
            metadata: {},
          }}
          characterData={{
            name: 'Companion',
            avatarUrl: 'https://cdn.nimi.test/companion.png',
            interactionState: {
              phase: 'idle',
              label: 'Here with you',
            },
          }}
          onToggleSettings={() => undefined}
          settingsActive={false}
          thinkingState="off"
          onThinkingToggle={() => undefined}
          onToggleFold={() => undefined}
          settingsContent={<div>Settings body</div>}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );

  assert.match(markup, /data-chat-mode-column="agent"/);
  assert.match(markup, /data-chat-right-card="primary"/);
  assert.match(markup, /data-chat-right-card="status"/);
  assert.match(markup, /data-chat-right-card="settings"/);
  assert.match(markup, /data-avatar-stage-viewport="true"/);
  assert.match(markup, /data-avatar-stage-pointer-enabled="true"/);
  assert.match(markup, /data-avatar-stage-hovered="false"/);
  assert.doesNotMatch(markup, /data-avatar-stage-dock="true"/);
  assert.match(markup, /data-avatar-backend-kind="sprite2d"/);
  assert.match(markup, /Companion/);
  assert.match(markup, /data-chat-right-card="settings"/);
});

test('avatar stage rail keeps the unified stage shell when runtime presentation already resolves to Live2D', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatRightPanelAvatarStageRail
          selectedTarget={{
            id: 'agent-live2d',
            source: 'agent',
            canonicalSessionId: 'thread-live2d',
            title: 'Airi',
            handle: '@airi',
            bio: 'friend agent',
            avatarUrl: 'https://cdn.nimi.test/airi.png',
            avatarFallback: 'A',
            previewText: null,
            updatedAt: null,
            unreadCount: 0,
            status: 'active',
            isOnline: null,
            metadata: {},
          }}
          characterData={{
            name: 'Airi',
            avatarUrl: 'https://cdn.nimi.test/airi.png',
            avatarPresentationProfile: {
              backendKind: 'live2d',
              avatarAssetRef: 'https://cdn.nimi.test/airi.model3.json',
              idlePreset: 'airi.idle',
            },
            interactionState: {
              phase: 'speaking',
              label: 'Speaking…',
            },
          }}
          onToggleSettings={() => undefined}
          settingsActive={false}
          thinkingState="off"
          onThinkingToggle={() => undefined}
          onToggleFold={() => undefined}
          settingsContent={<div>Settings body</div>}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );

  assert.match(markup, /data-avatar-stage-viewport="true"/);
  assert.match(markup, /data-avatar-live2d-status="loading"/);
  assert.match(markup, /Speaking…/);
  assert.match(markup, /Airi/);
});

test('avatar stage rail resolves live2d from shared binding and resource query caches without key-shape collisions', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    desktopAgentAvatarBindingQueryKey('agent-live2d'),
    {
      agentId: 'agent-live2d',
      resourceId: 'resource-live2d',
      updatedAtMs: 42,
    },
  );
  queryClient.setQueryData(
    desktopAgentAvatarResourcesQueryKey(),
    [{
      resourceId: 'resource-live2d',
      kind: 'live2d',
      displayName: 'Airi Live2D',
      sourceFilename: 'airi.model3.json',
      storedPath: '/tmp/airi-live2d',
      fileUrl: 'file:///tmp/airi-live2d/airi.model3.json',
      posterPath: null,
      importedAtMs: 10,
      updatedAtMs: 20,
      status: 'ready',
    }],
  );

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatRightPanelAvatarStageRail
          selectedTarget={{
            id: 'agent-live2d',
            source: 'agent',
            canonicalSessionId: 'thread-live2d',
            title: 'Airi',
            handle: '@airi',
            bio: 'friend agent',
            avatarUrl: 'https://cdn.nimi.test/airi.png',
            avatarFallback: 'A',
            previewText: null,
            updatedAt: null,
            unreadCount: 0,
            status: 'active',
            isOnline: null,
            metadata: {},
          }}
          characterData={{
            name: 'Airi',
            avatarUrl: 'https://cdn.nimi.test/airi.png',
            interactionState: {
              phase: 'idle',
              label: 'Here with you',
            },
          }}
          onToggleSettings={() => undefined}
          settingsActive={false}
          thinkingState="off"
          onThinkingToggle={() => undefined}
          onToggleFold={() => undefined}
          settingsContent={<div>Settings body</div>}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );

  assert.match(markup, /data-avatar-live2d-status="loading"/);
});

test('live2d diagnostic panel model exposes recovery diagnostics before hard fail-close', () => {
  const panel = resolveChatAgentAvatarLive2dDiagnosticPanelModel({
    status: 'loading',
    error: null,
    diagnostic: {
      backendKind: 'live2d',
      stage: 'ready',
      status: 'loading',
      assetRef: 'desktop-agent-avatar://agent-live2d',
      assetLabel: 'Airi Live2D',
      mocVersion: 6,
      resourceId: 'resource-live2d',
      fileUrl: 'file:///tmp/airi-live2d/airi.model3.json',
      modelUrl: 'live2d-memory://resource-live2d/airi.model3.json',
      error: null,
      errorUrl: null,
      errorStatus: null,
      runtimeUrls: ['live2d-memory://resource-live2d/airi.model3.json'],
      cubismCoreAvailable: true,
      assetProbeFailures: ['webgl-context-lost'],
      motionGroups: ['Idle', 'TapBody'],
      idleMotionGroup: 'Idle',
      speechMotionGroup: 'TapBody',
      recoveryAttemptCount: 2,
      recoveryReason: 'webgl-context-lost',
    },
  });

  assert.equal(panel?.kind, 'recovery');
  assert.equal(panel?.message, 'Recovering Live2D viewport');
  assert.ok(panel?.details.includes('recoveryReason=webgl-context-lost'));
  assert.ok(panel?.details.includes('recoveryAttemptCount=2'));
  assert.ok(panel?.details.includes('motionGroups=Idle,TapBody'));
});

test('live2d diagnostic panel model exposes motion fallback details on hard error', () => {
  const panel = resolveChatAgentAvatarLive2dDiagnosticPanelModel({
    status: 'error',
    error: 'Live2D model failed closed.',
    diagnostic: {
      backendKind: 'live2d',
      stage: 'ready',
      status: 'error',
      assetRef: 'desktop-agent-avatar://agent-live2d',
      assetLabel: 'Airi Live2D',
      mocVersion: 6,
      resourceId: 'resource-live2d',
      fileUrl: 'file:///tmp/airi-live2d/airi.model3.json',
      modelUrl: 'live2d-memory://resource-live2d/airi.model3.json',
      error: 'Live2D model failed closed.',
      errorUrl: null,
      errorStatus: null,
      runtimeUrls: ['live2d-memory://resource-live2d/airi.model3.json'],
      cubismCoreAvailable: true,
      assetProbeFailures: ['webgl-context-lost'],
      motionGroups: ['Idle', 'TapBody'],
      idleMotionGroup: 'Idle',
      speechMotionGroup: 'TapBody',
      recoveryAttemptCount: 1,
      recoveryReason: 'webgl-context-lost',
    },
  });

  assert.equal(panel?.kind, 'error');
  assert.equal(panel?.message, 'Live2D model failed closed.');
  assert.ok(panel?.details.includes('idleMotionGroup=Idle'));
  assert.ok(panel?.details.includes('speechMotionGroup=TapBody'));
  assert.ok(panel?.details.includes('motionGroups=Idle,TapBody'));
});

test('utility rail uses transparent chrome and keeps only materialized utility buttons', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatRightPanelUtilityRail
          onToggleSettings={() => undefined}
          settingsActive={false}
          thinkingState="off"
          onThinkingToggle={() => undefined}
          onToggleFold={() => undefined}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );

  assert.match(markup, /data-right-panel="agent-utility-rail"/);
  assert.match(markup, /data-utility-rail-chrome="transparent"/);
  assert.match(markup, /rounded-xl/);
  assert.doesNotMatch(markup, /bg-\[linear-gradient\(180deg,rgba\(250,252,252,0\.86\),rgba\(244,247,248,0\.92\)\)\]/u);
});
