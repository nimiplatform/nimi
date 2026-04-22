import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';

import {
  ChatAgentAnchoredAvatarStage,
} from '../src/shell/renderer/features/chat/chat-agent-anchored-avatar-stage.js';
import {
  ChatRightPanelUtilityRail,
} from '../src/shell/renderer/features/chat/chat-right-panel-character-rail.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('desktop agent mode no longer mounts anchored avatar stage as current chat truth', () => {
  const modeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-mode-content.tsx');
  const shellSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');

  assert.doesNotMatch(modeSource, /ChatAgentAvatarOverlay/);
  assert.doesNotMatch(modeSource, /chat-agent-avatar-overlay/);
  assert.match(shellSource, /stagePanelProps:\s*undefined/);
});

test('anchored avatar stage source no longer queries retired desktop avatar store or mounts carrier diagnostics', () => {
  const anchoredStageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-anchored-avatar-stage.tsx');
  const stageViewportSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-avatar-stage-viewport.tsx');

  assert.doesNotMatch(anchoredStageSource, /useQuery/u);
  assert.doesNotMatch(anchoredStageSource, /desktopAgentAvatarBindingQueryKey/u);
  assert.doesNotMatch(anchoredStageSource, /listDesktopAgentAvatarResources/u);
  assert.doesNotMatch(anchoredStageSource, /getDesktopAgentAvatarBinding/u);
  assert.doesNotMatch(anchoredStageSource, /resolveChatAgentAvatarLive2dDiagnosticPanelModel/u);
  assert.doesNotMatch(anchoredStageSource, /resolveChatAgentAvatarVrmDiagnosticPanelModel/u);
  assert.doesNotMatch(stageViewportSource, /ChatAgentAvatarLive2dViewport/u);
  assert.doesNotMatch(stageViewportSource, /ChatAgentAvatarVrmViewport/u);
  assert.doesNotMatch(stageViewportSource, /DESKTOP_AGENT_AVATAR_RENDERERS/u);
});

test('anchored avatar stage renders non-carrier sprite presentation even when runtime profile says live2d', () => {
  const markup = renderToStaticMarkup(
    <ChatAgentAnchoredAvatarStage
      selectedTarget={{
        id: 'agent-airi',
        source: 'agent',
        canonicalSessionId: 'thread-airi',
        title: 'Airi',
        handle: '@airi',
        bio: 'companion',
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
        },
        interactionState: {
          phase: 'speaking',
          label: 'Speaking…',
          emotion: 'focus',
          amplitude: 0.42,
        },
      }}
      placement="right-center"
      settingsActive={false}
    />,
  );

  assert.match(markup, /data-chat-agent-anchored-stage="true"/);
  assert.match(markup, /data-avatar-stage-attention-active="false"/);
  assert.match(markup, /data-avatar-backend-kind="sprite2d"/);
  assert.doesNotMatch(markup, /data-avatar-backend-kind="live2d"/);
  assert.doesNotMatch(markup, /data-chat-agent-stage-alert="true"/);
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
