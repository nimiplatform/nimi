import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildAgentCenterState } from '../src/state.js';
import type { AgentCenterStateInput } from '../src/types.js';

function stateInput(patch: Partial<AgentCenterStateInput> = {}): AgentCenterStateInput {
  return {
    executionConfig: {
      revision: 7,
      updatedAt: '2026-07-07T00:00:00.000Z',
      updatedByAppId: 'runtime',
      bindings: {
        'text.generate': { route: 'local', modelId: 'local/default' },
      },
    },
    readiness: {
      configRevision: 7,
      capabilities: [
        { capability: 'text.generate', state: 'ready', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
        { capability: 'image.generate', state: 'not_configured', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
        { capability: 'audio.synthesize', state: 'not_configured', reasonCode: '', probedAt: '2026-07-07T00:00:01.000Z' },
      ],
    },
    ...patch,
  };
}

describe('Agent Center state', () => {
  it('uses text.generate readiness as the base send gate without blocking on optional image/audio', () => {
    const state = buildAgentCenterState(stateInput());

    expect(state.baseTextReady).toBe(true);
    expect(state.capabilities.find((item) => item.capability === 'image.generate')?.blocksTextTurns).toBe(false);
    expect(state.capabilities.find((item) => item.capability === 'audio.synthesize')?.blocksTextTurns).toBe(false);
    expect(state.capabilities.find((item) => item.capability === 'audio.synthesize')?.editable).toBe(false);
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
