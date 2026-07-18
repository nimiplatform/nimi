import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildAgentCenterState } from '../src/state.js';
import type { AgentCenterStateInput } from '../src/types.js';

function stateInput(patch: Partial<AgentCenterStateInput> = {}): AgentCenterStateInput {
  return {
    agentAIConfig: {
      revision: 7,
      updatedAt: '2026-07-07T00:00:00.000Z',
      updatedByAppId: 'runtime',
      intents: {
        'text.generate': { route: 'local', modelId: 'local/default' },
        'text.embed': { route: 'local', modelId: 'local/default-embedding' },
      },
    },
    readiness: {
      configRevision: 7,
      capabilities: [
        { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
        { capability: 'text.embed', state: 'ready', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
        { capability: 'image.generate', state: 'not_configured', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
        { capability: 'audio.synthesize', state: 'not_configured', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
      ],
    },
    ...patch,
  };
}

function readySourceStatus(): NonNullable<AgentCenterStateInput['sourceContextStatus']> {
  return {
    schemaVersion: 'v2',
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    localAgentRef: 'local-agent:owner:agent',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'persona-1',
      worldId: 'world-1',
      ownerAccountId: 'owner-1',
      sourceHash: 'a'.repeat(64),
    },
    sourceSchemaVersion: 'realm.persona-character-core/v1',
    snapshotSchemaVersion: 'v2',
    snapshotHash: 'b'.repeat(64),
    capturedAt: '2026-07-11T01:02:03.000Z',
    worldContentHash: 'c'.repeat(64),
    materializationContextHash: 'd'.repeat(64),
    coverageSections: [
      { section: 'identity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'presentation', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'interaction_profile', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'assets', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'authoring', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'persona_style', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'content_profile', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'world_core', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'dependency_closure', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
    ],
  };
}

describe('Agent Center state', () => {
  it('uses text.generate readiness as the base send gate without blocking on optional image/audio', () => {
    const state = buildAgentCenterState(stateInput());

    expect(state.baseTextReady).toBe(true);
    expect(state.capabilities.find((item) => item.capability === 'text.embed')?.blocksTextTurns).toBe(false);
    expect(state.capabilities.find((item) => item.capability === 'image.generate')?.blocksTextTurns).toBe(false);
    expect(state.capabilities.find((item) => item.capability === 'audio.synthesize')?.blocksTextTurns).toBe(false);
    expect(state.capabilities.find((item) => item.capability === 'audio.synthesize')?.editable).toBe(true);
    expect(state.sourceContext.status).toBe('unknown');
  });

  it('keeps a missing first-turn context unknown without blocking the admitted text route', () => {
    const state = buildAgentCenterState(stateInput({
      sourceContextStatus: readySourceStatus(),
      turnContextSummary: null,
    }));

    expect(state.sourceContext.status).toBe('unknown');
    expect(state.sourceContext.source).toMatchObject({
      kind: 'personaCharacter',
      sourceHash: 'a'.repeat(64),
    });
    expect(state.baseTextReady).toBe(true);
    expect(state.runtimeStatus).toBe('ready');
  });

  it('drops raw and machine fields from fail-closed Agent Center state', () => {
    const sourceContextStatus = {
      ...readySourceStatus(),
      rawWorld: 'RAW_STATE_CANARY',
      actionHint: 'rebuild_private_context',
    } as unknown as NonNullable<AgentCenterStateInput['sourceContextStatus']>;
    const state = buildAgentCenterState(stateInput({ sourceContextStatus }));
    const serialized = JSON.stringify(state);

    expect(state.sourceContext.status).toBe('failed');
    expect(serialized).not.toMatch(/RAW_STATE_CANARY|rawWorld|reasonCode|actionHint|rebuild_private_context/u);
  });

  it('fails closed when Runtime inspect is unavailable and disables autonomy controls', () => {
    const state = buildAgentCenterState(stateInput({ inspect: null, autonomyMutationAvailable: false }));

    expect(state.autonomy.controlsDisabled).toBe(true);
    expect(state.autonomy.disabledReason).toBe('runtime inspect unavailable');
    expect(state.cognition.memoryState).toBe('unavailable');
  });

  it('keeps autonomy disabled when mutation handling is missing', () => {
    const state = buildAgentCenterState(stateInput({
      autonomyMutationAvailable: false,
      inspect: {
        lifecycleStatus: 'active',
        executionState: 'idle',
        statusText: 'ready',
        activeWorldId: null,
        activeUserId: null,
        updatedAt: null,
        currentEmotion: 'calm',
        proactiveInterruptibility: null,
        presentationProfile: null,
        autonomyMode: 'medium',
        autonomyEnabled: true,
        autonomyBudgetExhausted: false,
        autonomyUsedTokensInWindow: 4,
        autonomyDailyTokenBudget: 1000,
        autonomyMaxTokensPerHook: 120,
        autonomyWindowStartedAt: null,
        autonomySuspendedUntil: null,
        pendingHooksCount: 0,
        nextScheduledFor: null,
        pendingHooks: [],
        recentTerminalHooks: [],
        recentCanonicalMemories: [],
      } as never,
    }));

    expect(state.autonomy.controlsDisabled).toBe(true);
    expect(state.autonomy.disabledReason).toBe('runtime autonomy mutation unavailable');
  });

  it('projects Runtime autonomy usage numbers for the behavior budget surface', () => {
    const state = buildAgentCenterState(stateInput({
      autonomyMutationAvailable: true,
      inspect: {
        lifecycleStatus: 'active',
        executionState: 'idle',
        statusText: 'ready',
        activeWorldId: null,
        activeUserId: null,
        updatedAt: null,
        currentEmotion: 'calm',
        proactiveInterruptibility: null,
        presentationProfile: null,
        autonomyMode: 'medium',
        autonomyEnabled: true,
        autonomyBudgetExhausted: false,
        autonomyUsedTokensInWindow: 320,
        autonomyDailyTokenBudget: 2000,
        autonomyMaxTokensPerHook: 500,
        autonomyWindowStartedAt: '2026-07-08T00:00:00.000Z',
        autonomySuspendedUntil: null,
        pendingHooksCount: 0,
        nextScheduledFor: null,
        pendingHooks: [],
        recentTerminalHooks: [],
        recentCanonicalMemories: [],
      } as never,
    }));

    expect(state.autonomy.usedTokensInWindow).toBe(320);
    expect(state.autonomy.dailyTokenBudget).toBe(2000);
    expect(state.autonomy.maxTokensPerHook).toBe(500);
    expect(state.autonomy.windowStartedAt).toBe('2026-07-08T00:00:00.000Z');
  });

  it('projects cognition memory list only from Runtime inspect canonical memories', () => {
    const state = buildAgentCenterState(stateInput({
      autonomyMutationAvailable: true,
      inspect: {
        lifecycleStatus: 'active',
        executionState: 'chat-active',
        statusText: '正在处理一个非常长的中文状态文本，用于验证窄屏布局不会把按钮或标签挤出容器',
        activeWorldId: null,
        activeUserId: null,
        updatedAt: null,
        currentEmotion: 'focused',
        proactiveInterruptibility: null,
        presentationProfile: null,
        autonomyMode: 'low',
        autonomyEnabled: true,
        autonomyBudgetExhausted: false,
        autonomyUsedTokensInWindow: 12,
        autonomyDailyTokenBudget: 1200,
        autonomyMaxTokensPerHook: 80,
        autonomyWindowStartedAt: null,
        autonomySuspendedUntil: null,
        pendingHooksCount: 0,
        nextScheduledFor: null,
        pendingHooks: [],
        recentTerminalHooks: [],
        recentCanonicalMemories: [{
          memoryId: 'memory-runtime-1',
          canonicalClass: 'dyadic',
          kind: 'semantic',
          summary: '用户偏好运行时本地 Agent Center',
          updatedAt: null,
          sourceEventId: 'event-1',
          policyReason: 'runtime-inspect',
          recallScore: 0.9,
        }],
      } as never,
      memory: {
        recordCount: 1,
        records: [{
          memoryId: 'memory-observatory-only',
          summary: 'must not be displayed as recent canonical memory',
        }],
      } as never,
    }));

    expect(state.cognition.memoryState).toBe('ready');
    expect(state.cognition.recentCanonicalMemories).toHaveLength(1);
    expect(state.cognition.recentCanonicalMemories[0]?.memoryId).toBe('memory-runtime-1');
  });

  it('keeps public props closed to typed adapters instead of arbitrary feature slots', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/types.ts'), 'utf8');
    for (const forbidden of [
      ['model', 'Content'].join(''),
      ['diagnostics', 'Content'].join(''),
      ['render', 'Gated', 'Surface'].join(''),
      ['technical', 'Surfaces'].join(''),
      ['Capability', 'Studio'].join(''),
      ['AgentCenter', 'CapabilityProbePanel'].join(''),
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
