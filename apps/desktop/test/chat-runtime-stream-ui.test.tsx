import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import { StreamControllerProvider } from '../src/shell/renderer/features/turns/stream-controller-context.js';
import { createTestStreamController } from './helpers/test-stream-controller.js';
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

async function loadRuntimeStreamFooter() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.js');
  return module.RuntimeStreamFooter;
}

async function loadRuntimeAgentDebugMessageAccessory() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.js');
  return module.RuntimeAgentDebugMessageAccessory;
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
    <StreamControllerProvider controller={createTestStreamController()}>
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
      />
    </StreamControllerProvider>,
  );

  assert.match(markup, /The agent is replying\.\.\./u);
  assert.match(markup, /Stop generating/u);
});

test('runtime agent debug accessory renders runtime.agent.turns anchor evidence', async () => {
  const RuntimeAgentDebugMessageAccessory = await loadRuntimeAgentDebugMessageAccessory();
  const markup = renderToStaticMarkup(
    <RuntimeAgentDebugMessageAccessory
      message={buildCanonicalMessage({
        role: 'assistant',
        text: 'Reused runtime session.',
        kind: 'text',
        metadata: {
          debugType: 'agent-text-turn',
          prompt: 'Messages:\n[]',
          systemPrompt: 'Be concise.',
          rawModelOutput: null,
          normalizedModelOutput: null,
          statusCue: null,
          followUpInstruction: null,
          followUpTurn: false,
          chainId: null,
          followUpDepth: null,
          maxFollowUpTurns: null,
          followUpCanceledByUser: false,
          followUpSourceActionId: null,
          followUpDelayMs: null,
          runtimeAgentTurns: {
            transport: 'runtime.agent.turns',
            conversationAnchorId: 'anchor-rt-1',
            runtimeTurnId: 'turn-rt-1',
            runtimeStreamId: 'stream-rt-1',
            route: 'local',
            modelId: 'kimi-k2',
            connectorId: null,
            traceId: 'trace-rt-1',
            modelResolved: 'kimi-k2',
            routeDecision: 'local',
          },
        },
      })}
      debugVisible={true}
      summaryLabel="Debug"
      copyLabel="Copy"
      copiedLabel="Copied"
      followUpLabel="Follow-up"
      followUpInstructionLabel="Follow-up instruction"
      promptLabel="Prompt"
      systemPromptLabel="System prompt"
      rawOutputLabel="Raw output"
      normalizedOutputLabel="Normalized output"
    />,
  );

  assert.match(markup, /Runtime Agent Turns/u);
  assert.match(markup, /conversationAnchorId=anchor-rt-1/u);
  assert.match(markup, /runtimeTurnId=turn-rt-1/u);
  assert.match(markup, /runtimeStreamId=stream-rt-1/u);
  assert.match(markup, /traceId=trace-rt-1/u);
  assert.doesNotMatch(markup, /route=/u);
  assert.doesNotMatch(markup, /modelId=/u);
  assert.doesNotMatch(markup, /connectorId=/u);
  assert.doesNotMatch(markup, /modelResolved=/u);
  assert.doesNotMatch(markup, /routeDecision=/u);
});
