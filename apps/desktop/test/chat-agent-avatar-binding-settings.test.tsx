import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ChatAgentAvatarBindingSettings } from '../src/shell/renderer/features/chat/chat-agent-avatar-binding-settings.js';

test('agent avatar binding settings exposes import actions and local-library copy', () => {
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatAgentAvatarBindingSettings agentId="agent-1" agentName="Companion" />
    </QueryClientProvider>,
  );

  assert.match(markup, /data-testid="agent-avatar-binding-settings"/);
  assert.match(markup, /Import VRM/);
  assert.match(markup, /Import Live2D/);
  assert.match(markup, /Chat Backdrop/);
  assert.match(markup, /Import Backdrop Image/);
  assert.match(markup, /Local Avatar Library/);
  assert.match(markup, /desktop runtime/i);
});
