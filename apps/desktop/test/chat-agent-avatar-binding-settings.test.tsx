import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ChatAgentAvatarBindingSettings } from '../src/shell/renderer/features/chat/chat-agent-avatar-binding-settings.js';

test('agent avatar settings decommissions desktop-local carrier controls and keeps backdrop shell settings', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatAgentAvatarBindingSettings agentId="agent-1" agentName="Companion" />
    </QueryClientProvider>,
  );

  assert.match(markup, /data-testid="agent-avatar-binding-settings"/);
  assert.match(markup, /Desktop no longer imports, binds, or renders local VRM\/Live2D avatars/);
  assert.match(markup, /decommissioned the desktop-local avatar carrier path/i);
  assert.match(markup, /Chat Backdrop/);
  assert.match(markup, /Import Backdrop Image/);
  assert.match(markup, /apps\/avatar/);
  assert.doesNotMatch(markup, /Import VRM/);
  assert.doesNotMatch(markup, /Import Live2D/);
  assert.doesNotMatch(markup, /Local Avatar Library/);
});
