import { describe, expect, it } from 'vitest';
import { buildAgentCenterState } from '../src/state.js';
import type { AgentCenterAutonomyProjection, AgentCenterStateInput } from '../src/types.js';

const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
] as const;

function input(patch: Partial<AgentCenterStateInput> = {}): AgentCenterStateInput {
  const capabilities = [
    {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [],
    },
    {
      capabilityContract: 'text.embed',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [],
    },
  ];
  return {
    participation: PARTICIPATION,
    sharedAIConfig: {
      aiConfig: {
        owner: {
          owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
        },
        capabilities,
      },
      revision: '1',
      intents: capabilities.map((intent) => ({
        capability: intent.capabilityContract,
        route: 'local' as const,
        requiredFeatures: intent.requiredFeatures,
      })),
    },
    ...patch,
  };
}

function autonomy(revision: string | null): AgentCenterAutonomyProjection {
  return {
    revision,
    enabled: true,
    mode: 'low',
    budgetExhausted: false,
    usedTokensInWindow: 12,
    dailyTokenBudget: 1000,
    maxTokensPerHook: 100,
    windowStartedAt: null,
    suspendedUntil: null,
  };
}

describe('Agent Center state projection', () => {
  it('keeps the shared canonical AIConfig intent intact without product lifecycle fields', () => {
    const state = buildAgentCenterState(input());
    expect(state.sharedAIConfig?.aiConfig.owner?.owner.oneofKind).toBe(
      'runtimeLocalAgentSubsystem',
    );
    expect(state.sharedAIConfig?.intents[0]).toMatchObject({
      capability: 'text.generate',
      route: 'local',
    });
    expect(state.baseTextConfigured).toBe(true);
    expect(state.sharedAIConfig?.revision).toBe('1');
    expect(JSON.stringify(state.sharedAIConfig)).not.toMatch(/readiness|updatedAt/u);
    expect(state.capabilities.map((capability) => capability.capability)).toEqual(
      PARTICIPATION.map((row) => row.capabilityContract),
    );
  });

  it('distinguishes canonical not-configured state from an unavailable snapshot', () => {
    const notConfigured = buildAgentCenterState(input({ sharedAIConfig: null }));
    expect(notConfigured.agentAIConfigMutationDisabledReason).toBeNull();
    expect(notConfigured.runtimeStatus).toBe('ready');
    expect(notConfigured.sharedAIConfig).toBeNull();

    expect(buildAgentCenterState({}).agentAIConfigMutationDisabledReason).toBe(
      'agent-ai-config-snapshot-unavailable',
    );
    expect(buildAgentCenterState(input()).agentAIConfigMutationDisabledReason).toBeNull();
  });

  it('keeps autonomy revision and presentation revision independent from shared AIConfig', () => {
    const state = buildAgentCenterState(
      input({
        autonomy: autonomy('autonomy:4'),
        appearance: { status: 'ready', presentationRevision: 'presentation:9' },
      }),
    );
    expect([state.autonomyRevision, state.presentationRevision]).toEqual([
      'autonomy:4',
      'presentation:9',
    ]);
  });

  it('keeps Manager cognition status separate from Cognition-owned Memory', () => {
    const current = input().sharedAIConfig!;
    const audioIntent = {
      capabilityContract: 'audio.transcribe',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [],
    };
    const state = buildAgentCenterState(
      input({
        sharedAIConfig: {
          ...current,
          aiConfig: {
            ...current.aiConfig,
            capabilities: [...current.aiConfig.capabilities, audioIntent],
          },
          intents: [
            ...current.intents,
            { capability: 'audio.transcribe', route: 'local', requiredFeatures: [] },
          ],
        },
        manager: {
          lifecycleStatus: 'active',
          executionState: 'idle',
          statusText: 'configured',
          currentEmotion: 'calm',
          source: null,
          context: null,
        },
      }),
    );
    expect(state.capabilities.map((entry) => entry.capability)).toContain('audio.transcribe');
    expect(state.cognition.recentCanonicalMemoryCount).toBe(0);
    expect(state.cognition.memory).toBeNull();
    expect(JSON.stringify(state.cognition)).not.toMatch(/localAgentRef|ownerUserId|runtimeSourceRef/u);
  });

  it('projects dedicated Agent-private Memory without rewriting its owner result', () => {
    const memory = {
      outcome: 'ready' as const,
      enabled: true,
      adoptionRequired: false,
      items: [{
        memoryId: 'memory-opaque', content: 'The user prefers tea', epistemicStatus: 'explicit' as const,
        lifecycle: 'current' as const, occurredAt: '2026-08-27T10:00:00Z', updatedAt: '2026-08-27T10:00:00Z',
        sourceExplanation: 'Committed user message',
      }],
      currentCount: 1,
      supersededCount: 0,
      forgottenCount: 0,
    };
    const state = buildAgentCenterState(input({ cognitionMemory: memory }));
    expect(state.cognition.memory).toBe(memory);
    expect(state.cognition.memoryState).toBe('ready');
    expect(state.cognition.recentCanonicalMemoryCount).toBe(1);
  });

  it('projects missing required and optional intents as configuration facts without probe truth', () => {
    const current = input().sharedAIConfig!;
    const state = buildAgentCenterState(
      input({
        sharedAIConfig: {
          ...current,
          aiConfig: { ...current.aiConfig, capabilities: [] },
          intents: [],
        },
      }),
    );
    const capabilities = new Map(state.capabilities.map((entry) => [entry.capability, entry]));

    expect(capabilities.get('text.generate')).toMatchObject({
      required: true,
      configurationState: 'not_configured',
      summary: 'Not configured',
    });
    expect(capabilities.get('audio.transcribe')).toMatchObject({
      required: false,
      configurationState: 'not_configured',
      summary: 'Optional capability not configured',
    });
    expect(JSON.stringify(state)).not.toContain('readiness');
    expect(JSON.stringify(state)).not.toContain('probedAt');
  });
});
