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

async function loadRuntimeStreamFooter() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-runtime-stream-ui.js');
  return module.RuntimeStreamFooter;
}

async function loadResolveRuntimeVoicePlaybackFrameCue() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-runtime-stream-ui.js');
  return module.resolveRuntimeVoicePlaybackFrameCue;
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

test('runtime stream footer keeps a visible waiting label after first packet when streaming text is hidden', async () => {
  const RuntimeStreamFooter = await loadRuntimeStreamFooter();
  const markup = renderToStaticMarkup(
    <RuntimeStreamFooter
      chatId="thread-1"
      assistantName="Companion"
      assistantAvatarUrl={null}
      assistantKind="agent"
      streamState={{
        chatId: 'thread-1',
        phase: 'streaming',
        partialText: '',
        partialReasoningText: '',
        errorMessage: null,
        interrupted: false,
        startedAt: 0,
        firstPacketAt: 1,
        lastActivityAt: 1,
        idleDeadlineAt: 2,
        reasonCode: null,
        traceId: null,
        cancelSource: null,
      }}
      stopLabel="Stop generating"
      interruptedLabel="Interrupted"
      reasoningLabel="Reasoning"
      waitingLabel="The agent is replying..."
      showStreamingText={false}
    />,
  );

  assert.match(markup, /The agent is replying\.\.\./u);
  assert.match(markup, /Stop generating/u);
});

test('runtime voice frame cue prefers admitted envelope truth over local estimator fallback', async () => {
  const resolveRuntimeVoicePlaybackFrameCue = await loadResolveRuntimeVoicePlaybackFrameCue();
  const frame = resolveRuntimeVoicePlaybackFrameCue({
    playbackCueEnvelope: {
      version: 'v1',
      source: 'provider',
      cues: [{
        offsetMs: 0,
        durationMs: 300,
        amplitude: 0.77,
        visemeId: 'ee',
      }],
    },
    currentTimeSeconds: 0.12,
    timeDomainSamples: new Uint8Array([128, 220, 64, 216, 72, 208, 80, 200]),
    frequencySamples: new Uint8Array([24, 36, 54, 88, 144, 208, 220, 240]),
  });

  assert.equal(frame.source, 'envelope');
  assert.equal(frame.cue.visemeId, 'ee');
  assert.equal(frame.cue.amplitude, 0.77);
});

test('runtime voice frame cue falls back to desktop-local estimator when envelope is absent', async () => {
  const resolveRuntimeVoicePlaybackFrameCue = await loadResolveRuntimeVoicePlaybackFrameCue();
  const frame = resolveRuntimeVoicePlaybackFrameCue({
    playbackCueEnvelope: null,
    currentTimeSeconds: 0.32,
    timeDomainSamples: new Uint8Array([128, 164, 182, 168, 128, 98, 82, 96]),
    frequencySamples: new Uint8Array([220, 208, 172, 118, 70, 42, 16, 8]),
  });

  assert.equal(frame.source, 'estimator');
  assert.ok(frame.cue.amplitude > 0.12);
  assert.ok(frame.cue.visemeId === 'ou' || frame.cue.visemeId === 'oh' || frame.cue.visemeId === 'aa');
  assert.ok(frame.estimatorFrame);
});

test('runtime voice frame cue carries estimator state so fallback output can be stabilized across frames', async () => {
  const resolveRuntimeVoicePlaybackFrameCue = await loadResolveRuntimeVoicePlaybackFrameCue();
  const first = resolveRuntimeVoicePlaybackFrameCue({
    playbackCueEnvelope: null,
    currentTimeSeconds: 0.16,
    timeDomainSamples: new Uint8Array([128, 170, 214, 184, 128, 86, 50, 82]),
    frequencySamples: new Uint8Array([232, 220, 176, 110, 68, 36, 18, 8]),
  });
  const second = resolveRuntimeVoicePlaybackFrameCue({
    playbackCueEnvelope: null,
    currentTimeSeconds: 0.18,
    timeDomainSamples: new Uint8Array([128, 168, 206, 178, 128, 92, 58, 88]),
    frequencySamples: new Uint8Array([228, 214, 170, 116, 70, 38, 18, 8]),
    previousEstimatorFrame: first.estimatorFrame,
  });

  assert.equal(first.source, 'estimator');
  assert.equal(second.source, 'estimator');
  assert.ok(first.estimatorFrame);
  assert.ok(second.estimatorFrame);
  assert.ok(second.cue.amplitude > 0.12);
  assert.ok(second.estimatorFrame!.stableFrames >= 1);
});
