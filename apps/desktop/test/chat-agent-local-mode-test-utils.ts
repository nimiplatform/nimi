import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { clearPlatformClient, createPlatformClient } from '@nimiplatform/sdk';
import { ScenarioJobStatus, createNimiError, toProtoStruct } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { resetRuntimeLocalModelWarmCacheForTests } from '../src/runtime/llm-adapter/execution/runtime-ai-bridge.js';

import {
  CORE_CHAT_AGENT_MOD_ID,
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntimeAgentTurn,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
} from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import {
  findRuntimeRouteModelProfile,
  resolveAgentChatRequestedMaxOutputTokens,
} from '../src/shell/renderer/features/chat/chat-nimi-route-view.js';
import { resolveAgentTurnTotalTimeoutMs } from '../src/shell/renderer/features/chat/chat-agent-timeouts.js';
import {
  findAgentConversationThreadByAgentId,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
} from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import { hydrateAgentThreadBundleFromRuntimeSessionSnapshot } from '../src/shell/renderer/features/chat/chat-agent-session-hydration.js';
import {
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
} from '../src/shell/renderer/features/chat/chat-shared-thinking.js';
import type { AgentLocalThreadSummary } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-types.js';
import {
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function createRuntimeTurnTimeline(input: {
  turnId: string;
  streamId: string;
  channel: 'text' | 'state';
  sequence: number;
  offsetMs?: number;
}) {
  return {
    turnId: input.turnId,
    streamId: input.streamId,
    channel: input.channel,
    offsetMs: input.offsetMs ?? 10,
    sequence: input.sequence,
    startedAtWall: '2026-04-25T00:00:00.000Z',
    observedAtWall: '2026-04-25T00:00:00.010Z',
    timebaseOwner: 'runtime' as const,
    projectionRuleId: 'K-AGCORE-051' as const,
    clockBasis: 'monotonic_with_wall_anchor' as const,
    providerNeutral: true as const,
    appLocalAuthority: false as const,
  };
}

function createLocalTextProjection() {
  return {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'llama3',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      source: 'local' as const,
      provider: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-model-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:llama3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
}

function createCloudTextProjection() {
  return {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'cloud' as const,
      connectorId: 'connector-openai',
      model: 'gpt-5.4-mini',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      source: 'cloud' as const,
      provider: 'openai',
      model: 'gpt-5.4-mini',
      modelId: 'gpt-5.4-mini',
      connectorId: 'connector-openai',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:connector-openai:gpt-5.4-mini',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: true,
        traceModeSupport: 'separate' as const,
        supportsImageInput: true,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
}

type CapturedRuntimeTextStreamInput = {
  model?: string;
  route?: string;
  connectorId?: string;
  input: Array<{
    role: string;
    content: string;
    name?: string | undefined;
  }> | string;
  system?: string | null;
  maxTokens?: number;
  reasoning?: unknown;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export {
  assert,
  path,
  test,
  clearPlatformClient,
  createPlatformClient,
  ScenarioJobStatus,
  createNimiError,
  toProtoStruct,
  ReasonCode,
  resetRuntimeLocalModelWarmCacheForTests,
  CORE_CHAT_AGENT_MOD_ID,
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntimeAgentTurn,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
  findRuntimeRouteModelProfile,
  resolveAgentChatRequestedMaxOutputTokens,
  resolveAgentTurnTotalTimeoutMs,
  findAgentConversationThreadByAgentId,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
  createEmptyAIConfig,
  readWorkspaceFile,
  createRuntimeTurnTimeline,
  createLocalTextProjection,
  createCloudTextProjection,
};

export type {
  AgentLocalThreadSummary,
  CapturedRuntimeTextStreamInput,
};
