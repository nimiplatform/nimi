import { createNimiAIScopeRef } from '@nimiplatform/sdk/ai';
import { describe, expect, it } from 'vitest';
import { buildAgentCenterState } from '../src/state.js';
import type { AgentCenterAutonomyProjection, AgentCenterStateInput } from '../src/types.js';

function input(patch: Partial<AgentCenterStateInput> = {}): AgentCenterStateInput {
  return {
    modelSettings: {
      scopeRef: createNimiAIScopeRef({ kind: 'feature', ownerId: 'runtime.agent.model-settings', surfaceId: 'local-agent:test' }),
      capabilities: ['text.generate', 'text.embed'],
      routeIntents: [
        { capability: 'text.generate', provider: '', model: 'text', routePolicy: 'local' },
        { capability: 'text.embed', provider: '', model: 'embed', routePolicy: 'local' },
      ],
      readiness: [
        { capability: 'text.generate', state: 'ready', reason: '', observedAt: null },
        { capability: 'text.embed', state: 'ready', reason: '', observedAt: null },
      ],
      configurationRevision: '7',
    },
    ...patch,
  };
}

function autonomy(revision: string | null): AgentCenterAutonomyProjection {
  return {
    revision, enabled: true, mode: 'low', budgetExhausted: false,
    usedTokensInWindow: 12, dailyTokenBudget: 1000, maxTokensPerHook: 100,
    windowStartedAt: null, suspendedUntil: null,
  };
}

describe('Agent Center state projection', () => {
  it('keeps the dedicated model-settings projection and decimal revision intact', () => {
    const state = buildAgentCenterState(input());
    expect(state.configRevision).toBe('7');
    expect(state.modelSettings?.routeIntents[0]?.model).toBe('text');
    expect(state.diagnostics.configRevision).toBe('7');
  });

  it('fails closed when the model snapshot or decimal revision is absent', () => {
    expect(buildAgentCenterState(input({ modelSettings: null })).agentAIConfigMutationDisabledReason)
      .toBe('agent-ai-config-snapshot-unavailable');
    expect(buildAgentCenterState(input({ modelSettings: { ...input().modelSettings!, configurationRevision: '01' } }))
      .agentAIConfigMutationDisabledReason).toBe('agent-ai-config-revision-unavailable');
  });

  it('keeps configuration, autonomy, and presentation revisions independent', () => {
    const state = buildAgentCenterState(input({
      autonomy: autonomy('autonomy:4'),
      appearance: { status: 'ready', presentationRevision: 'presentation:9' },
    }));
    expect([state.configRevision, state.autonomyRevision, state.presentationRevision])
      .toEqual(['7', 'autonomy:4', 'presentation:9']);
  });

  it('projects canonical dynamic capability ids and count-only cognition', () => {
    const current = input().modelSettings!;
    const state = buildAgentCenterState(input({
      modelSettings: {
        ...current,
        capabilities: [...current.capabilities, 'audio.transcribe'],
        routeIntents: [...current.routeIntents, { capability: 'audio.transcribe', provider: '', model: 'stt', routePolicy: 'local' }],
        readiness: [...current.readiness, { capability: 'audio.transcribe', state: 'ready', reason: '', observedAt: null }],
      },
      inspect: {
        lifecycleStatus: 'active', executionState: 'idle', statusText: 'ready', currentEmotion: 'calm',
        recentCanonicalMemories: [{ summary: 'private canary' }], presentationProfile: null,
      } as never,
    }));
    expect(state.capabilities.map((entry) => entry.capability)).toContain('audio.transcribe');
    expect(state.cognition.recentCanonicalMemoryCount).toBe(1);
    expect(JSON.stringify(state.cognition)).not.toContain('private canary');
  });

  it('keeps text generation and embedding required while other capabilities remain optional', () => {
    const current = input().modelSettings!;
    const state = buildAgentCenterState(input({
      modelSettings: {
        ...current,
        capabilities: [...current.capabilities, 'audio.transcribe'],
        routeIntents: [
          ...current.routeIntents,
          { capability: 'audio.transcribe', provider: '', model: 'stt', routePolicy: 'local' },
        ],
        readiness: [
          { capability: 'text.generate', state: 'blocked', reason: 'missing', observedAt: null },
          { capability: 'text.embed', state: 'blocked', reason: 'missing', observedAt: null },
          { capability: 'audio.transcribe', state: 'blocked', reason: 'missing', observedAt: null },
        ],
      },
    }));
    const capabilities = new Map(state.capabilities.map((entry) => [entry.capability, entry]));

    expect(capabilities.get('text.generate')).toMatchObject({
      required: true,
      blocksTextTurns: true,
      summary: 'Not configured',
    });
    expect(capabilities.get('text.embed')).toMatchObject({
      required: true,
      blocksTextTurns: true,
      summary: 'Not configured',
    });
    expect(capabilities.get('audio.transcribe')).toMatchObject({
      required: false,
      blocksTextTurns: false,
      summary: 'Optional route not configured',
    });
  });
});
