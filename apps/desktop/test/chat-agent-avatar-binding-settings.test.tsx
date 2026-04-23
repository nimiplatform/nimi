import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ChatAgentAvatarAppLauncher } from '../src/shell/renderer/features/chat/chat-agent-avatar-app-launcher.js';
import { ChatAgentAvatarBindingSettings } from '../src/shell/renderer/features/chat/chat-agent-avatar-binding-settings.js';
import { ChatAgentAvatarSettingsPanel } from '../src/shell/renderer/features/chat/chat-agent-avatar-settings-panel.js';

test('agent avatar binding settings keep desktop-local backdrop copy scoped to the shell', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatAgentAvatarBindingSettings agentId="agent-1" agentName="Companion" />
    </QueryClientProvider>,
  );

  assert.match(markup, /data-testid="agent-avatar-binding-settings"/);
  assert.match(markup, /Local Shell Appearance/);
  assert.match(markup, /never changes avatar binding truth/i);
  assert.match(markup, /Chat Backdrop/);
  assert.match(markup, /Import Backdrop Image/);
  assert.doesNotMatch(markup, /Import VRM/);
  assert.doesNotMatch(markup, /Import Live2D/);
  assert.doesNotMatch(markup, /Local Avatar Library/);
});

test('agent avatar settings panel exposes model, launch, session, and local-shell sections', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatAgentAvatarSettingsPanel
        selectedTarget={{ id: 'agent-1', title: 'Companion' }}
        activeThreadId="thread-1"
        activeConversationAnchorId="anchor-1"
        presentationProfile={{
          backendKind: 'vrm',
          avatarAssetRef: 'asset://vrm/companion',
          expressionProfileRef: '',
          idlePreset: '',
          interactionPolicyRef: '',
          defaultVoiceReference: 'voice://companion',
        }}
      />
    </QueryClientProvider>,
  );

  assert.match(markup, /data-testid="chat-agent-avatar-settings-panel"/);
  assert.match(markup, /Avatar Model/);
  assert.match(markup, /Companion Launch/);
  assert.match(markup, /Session Link/);
  assert.match(markup, /Local Shell Appearance/);
  assert.match(markup, /Restricted Runtime Profile Editor/);
  assert.match(markup, /Save Runtime Profile/);
  assert.match(markup, /Clear Runtime Profile/);
  assert.match(markup, /Launch Policy/);
  assert.match(markup, /Reuse current target/);
  assert.match(markup, /Auto-refresh live inventory/);
  assert.match(markup, /Refresh Live Inventory/);
  assert.match(markup, /asset:\/\/vrm\/companion/);
  assert.match(markup, /voice:\/\/companion/);
});

test('agent avatar app launcher explains current-chat targeting for existing anchors', () => {
  const markup = renderToStaticMarkup(
    <ChatAgentAvatarAppLauncher
      selectedTarget={{ id: 'agent-1', title: 'Companion' }}
      activeThreadId="thread-1"
      activeConversationAnchorId="anchor-1"
    />,
  );

  assert.match(markup, /Companion Launch/);
  assert.match(markup, /Desktop handoff ready|Desktop runtime required/);
  assert.match(markup, /Continue current anchor/);
  assert.match(markup, /anchor-1/);
  assert.match(markup, /Open New Companion/);
  assert.match(markup, /desktop-avatar-agent-1-thread-1/);
});

test('agent avatar app launcher explains open-new anchor launches', () => {
  const markup = renderToStaticMarkup(
    <ChatAgentAvatarAppLauncher
      selectedTarget={{ id: 'agent-1', title: 'Companion' }}
      activeThreadId={null}
      activeConversationAnchorId={null}
    />,
  );

  assert.match(markup, /Open new anchor/);
  assert.match(markup, /Launch asks Nimi Avatar to create a fresh explicit anchor\./);
  assert.match(markup, /desktop-avatar-agent-1-open-new-anchor/);
});

test('agent avatar app launcher can prioritize new companion launch', () => {
  const markup = renderToStaticMarkup(
    <ChatAgentAvatarAppLauncher
      selectedTarget={{ id: 'agent-1', title: 'Companion' }}
      activeThreadId="thread-1"
      activeConversationAnchorId="anchor-1"
      defaultLaunchTarget="new"
    />,
  );

  assert.ok(markup.indexOf('Open New Companion') < markup.indexOf('Open in Nimi Avatar'));
});
