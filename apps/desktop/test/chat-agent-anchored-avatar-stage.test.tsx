import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';

import {
  resolveChatAgentAvatarLive2dDiagnosticPanelModel,
  resolveChatAgentAvatarVrmDiagnosticPanelModel,
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

test('live2d diagnostic panel model still reports bounded recovery details for isolated legacy diagnostics', () => {
  const panel = resolveChatAgentAvatarLive2dDiagnosticPanelModel({
    status: 'loading',
    error: null,
    diagnostic: {
      backendKind: 'live2d',
      stage: 'ready',
      status: 'loading',
      assetRef: 'https://cdn.nimi.test/avatars/airi.model3.json',
      assetLabel: 'Airi Live2D',
      resourceId: null,
      fileUrl: 'https://cdn.nimi.test/avatars/airi.model3.json',
      modelUrl: 'https://cdn.nimi.test/avatars/airi.model3.json',
      error: null,
      errorUrl: null,
      errorStatus: null,
      runtimeUrls: ['https://cdn.nimi.test/avatars/airi.model3.json'],
      cubismCoreAvailable: true,
      assetProbeFailures: ['webgl-context-lost'],
      motionGroups: ['Idle', 'TapBody'],
      idleMotionGroup: 'Idle',
      speechMotionGroup: 'TapBody',
      recoveryAttemptCount: 2,
      recoveryReason: 'webgl-context-lost',
      mocVersion: 6,
    },
  });

  assert.equal(panel?.kind, 'recovery');
  assert.equal(panel?.message, 'Recovering Live2D viewport');
  assert.ok(panel?.details.includes('recoveryReason=webgl-context-lost'));
  assert.ok(panel?.details.includes('recoveryAttemptCount=2'));
  assert.ok(panel?.details.includes('motionGroups=Idle,TapBody'));
});

test('vrm diagnostic panel model still reports bounded network recovery details for isolated legacy diagnostics', () => {
  const panel = resolveChatAgentAvatarVrmDiagnosticPanelModel({
    status: 'loading',
    error: null,
    diagnostic: {
      backendKind: 'vrm',
      stage: 'ready',
      status: 'loading',
      assetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
      assetLabel: 'Airi VRM',
      resourceId: null,
      assetUrl: 'https://cdn.nimi.test/avatars/airi.vrm',
      networkAssetUrl: 'https://cdn.nimi.test/avatars/airi.vrm',
      posterUrl: null,
      error: null,
      source: 'network',
      attentionActive: true,
      recoveryAttemptCount: 1,
      recoveryReason: 'webgl-context-lost',
      resizePosture: 'tracked-host-size',
      viewportWidth: 320,
      viewportHeight: 480,
      hostRenderable: true,
      canvasEpoch: 3,
    },
  });

  assert.equal(panel?.kind, 'loading');
  assert.equal(panel?.message, 'Recovering VRM viewport');
  assert.ok(panel?.details.includes('source=network'));
  assert.ok(panel?.details.includes('recoveryReason=webgl-context-lost'));
  assert.ok(panel?.details.includes('recoveryAttemptCount=1'));
  assert.ok(panel?.details.includes('canvasEpoch=3'));
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
