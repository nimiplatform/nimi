import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationCanonicalMessage } from '@nimiplatform/nimi-kit/features/chat/headless';

async function loadRuntimeImageMessageContent() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-runtime-stream-ui.js');
  return module.RuntimeImageMessageContent;
}

function buildCanonicalMessage(overrides: Partial<ConversationCanonicalMessage> = {}): ConversationCanonicalMessage {
  return {
    id: 'message-image-1',
    sessionId: 'thread-1',
    targetId: 'agent-1',
    source: 'agent',
    role: 'user',
    text: 'Please inspect this image.',
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    status: 'complete',
    kind: 'image',
    senderName: 'You',
    senderKind: 'human',
    metadata: {},
    ...overrides,
  };
}

test('runtime image message content prefers attachment urls over legacy mediaUrl metadata', async () => {
  const RuntimeImageMessageContent = await loadRuntimeImageMessageContent();
  const markup = renderToStaticMarkup(
    <RuntimeImageMessageContent
      imageLabel="Image attachment"
      showCaptionLabel="Show prompt"
      hideCaptionLabel="Hide prompt"
      message={buildCanonicalMessage({
        metadata: {
          attachments: [{
            url: 'https://cdn.nimi.test/attachments/primary.png',
          }, {
            url: 'https://cdn.nimi.test/attachments/secondary.png',
          }],
          mediaUrl: 'https://cdn.nimi.test/legacy/fallback.png',
        },
      })}
    />,
  );

  assert.match(markup, /src="https:\/\/cdn\.nimi\.test\/attachments\/primary\.png"/u);
  assert.match(markup, /src="https:\/\/cdn\.nimi\.test\/attachments\/secondary\.png"/u);
  assert.doesNotMatch(markup, /legacy\/fallback\.png/u);
  assert.match(markup, /aria-label="Show prompt"/u);
  assert.doesNotMatch(markup, /Please inspect this image\./u);
});

test('runtime image message content falls back to mediaUrl when attachment metadata is absent', async () => {
  const RuntimeImageMessageContent = await loadRuntimeImageMessageContent();
  const markup = renderToStaticMarkup(
    <RuntimeImageMessageContent
      imageLabel="Image attachment"
      showCaptionLabel="Show prompt"
      hideCaptionLabel="Hide prompt"
      message={buildCanonicalMessage({
        text: '',
        metadata: {
          mediaUrl: 'https://cdn.nimi.test/legacy/fallback.png',
        },
      })}
    />,
  );

  assert.match(markup, /src="https:\/\/cdn\.nimi\.test\/legacy\/fallback\.png"/u);
});
