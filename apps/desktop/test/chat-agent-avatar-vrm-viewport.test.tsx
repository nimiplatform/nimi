import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChatAgentAvatarVrmViewport from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.js';

test('vrm viewport exposes debug overlay in minimal chrome when vrm is not ready', () => {
  const markup = renderToStaticMarkup(
    <ChatAgentAvatarVrmViewport
      chrome="minimal"
      input={{
        label: 'Companion',
        assetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
        posterUrl: 'https://cdn.nimi.test/avatars/airi.png',
        idlePreset: null,
        expressionProfileRef: null,
        interactionPolicyRef: null,
        defaultVoiceReference: null,
        snapshot: {
          presentation: {
            backendKind: 'vrm',
            avatarAssetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
          },
          interaction: {
            phase: 'idle',
            actionCue: 'Here with you',
          },
        },
      }}
    />,
  );

  assert.match(markup, /data-avatar-vrm-debug="true"/);
  assert.match(markup, /status: loading/);
  assert.match(markup, /assetRef: https:\/\/cdn\.nimi\.test\/avatars\/airi\.vrm/);
});
