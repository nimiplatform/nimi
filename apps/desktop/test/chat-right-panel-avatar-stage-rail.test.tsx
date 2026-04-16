import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';

import { ChatRightPanelAvatarStageRail } from '../src/shell/renderer/features/chat/chat-right-panel-avatar-stage-rail.js';

test('avatar stage rail renders a full-height stage viewport with a separate bottom dock', () => {
  const markup = renderToStaticMarkup(
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
      />
    </TooltipProvider>,
  );

  assert.match(markup, /data-right-panel="avatar-stage-rail"/);
  assert.match(markup, /data-avatar-stage-viewport="true"/);
  assert.match(markup, /data-avatar-stage-dock="true"/);
  assert.match(markup, /Companion/);
  assert.doesNotMatch(markup, /friend agent/);
});
