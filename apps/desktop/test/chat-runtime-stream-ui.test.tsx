import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';

function renderToStaticMarkup(element: React.ReactNode): string {
  return renderMarkup(
    <DesktopRendererBindingProvider bindings={{ app: { commands: {} } } as DesktopCanonicalRendererBindings}>
      {element}
    </DesktopRendererBindingProvider>,
  );
}

async function loadRuntimeImageMessageContent() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.js');
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

test('image failures retain readable content and keep diagnostic codes collapsed', async () => {
  const RuntimeImageMessageContent = await loadRuntimeImageMessageContent();
  const markup = renderToStaticMarkup(<RuntimeImageMessageContent
    imageLabel="Image" showCaptionLabel="Show prompt" hideCaptionLabel="Hide prompt"
    failureMessage="Image generation failed. Your text is kept."
    technicalDetailsLabel="Technical details"
    message={buildCanonicalMessage({ status: 'error', metadata: { imageFailureReasonCode: 'AI_MEDIA_OPTION_UNSUPPORTED', imageOperationId: 'action-1' } })}
  />);
  assert.match(markup, /Image generation failed. Your text is kept./u);
  assert.match(markup, /<details[^>]*><summary[^>]*>Technical details<\/summary>.*AI_MEDIA_OPTION_UNSUPPORTED/u);
  assert.doesNotMatch(markup, /<details[^>]*\bopen\b/u);
});
