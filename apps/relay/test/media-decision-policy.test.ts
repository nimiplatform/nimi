import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideMediaExecution } from '../src/main/media/index.js';
import { DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS } from '../src/main/settings/types.js';
import type { DecideMediaExecutionInput } from '../src/main/media/index.js';

function createInput(): DecideMediaExecutionInput {
  return {
    aiClient: {
      generateObject: async () => {
        throw new Error('generateObject should not be called for marker override tests');
      },
    },
    turnTxnId: 'turn-1',
    defaultSettings: {
      ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
      imageRouteSource: 'local',
      selectedProfileId: 'local-chat-default',
    },
    resolvedPolicy: {
      deliveryPolicy: {
        style: 'natural',
        allowMultiReply: false,
      },
      voicePolicy: {
        enabled: false,
        autonomy: 'off',
        conversationMode: 'off',
        autoPlayReplies: false,
        selectedVoiceId: null,
        selectionMode: 'auto',
      },
      mediaPolicy: {
        autonomy: 'natural',
        visualComfortLevel: 'natural-visuals',
        routeSource: 'local',
        nsfwPolicy: 'allowed',
        allowVisualAuto: true,
        allowAutoVisualHighRisk: false,
      },
      contentBoundary: {
        relationshipBoundaryPreset: 'balanced',
        visualComfortLevel: 'natural-visuals',
        routeSource: 'local',
        relationshipState: 'new',
      },
      inspectFlags: {
        diagnosticsVisible: false,
        runtimeInspectorVisible: false,
      },
    },
    userText: 'show me what you look like',
    assistantText: 'sending you a picture now',
    target: {
      id: 'target-1',
      handle: 'nimi',
      displayName: 'Nimi',
      avatarUrl: null,
      bio: null,
      dna: {
        identityLines: [],
        rulesLines: [],
        replyStyleLines: [],
      },
      metadata: {},
      worldId: null,
      worldName: null,
    },
    worldId: null,
    messages: [],
    promptTrace: null,
    nsfwPolicy: 'allowed',
    routeSourceHint: 'local',
    markerOverrideIntent: {
      type: 'image',
      source: 'explicit',
      prompt: 'portrait',
      pendingMessageId: 'pending-1',
      plannerTrigger: 'marker-override',
    },
  };
}

describe('relay media decision policy', () => {
  it('resolves local image profile routes from selectedProfileId without requiring legacy localModelId', async () => {
    const result = await decideMediaExecution(createInput());
    assert.equal(result.kind, 'execute');
    assert.equal(result.resolvedRoute?.source, 'local');
    assert.equal(result.resolvedRoute?.model, 'media/local/z_image_turbo');
  });
});
