import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { createRuntimeAgentCenterAdapter } from '../src/runtime.js';
import type { AgentCenterRuntimeAdapter } from '../src/types.js';

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      return collectSourceFiles(full);
    }
    return /\.(ts|tsx)$/u.test(entry) ? [full] : [];
  });
}

describe('Agent Center Runtime adapter', () => {
  it('loads Runtime Agent AI Config, inspect, memory, and bounded source/context through typed adapters', async () => {
    const calls: string[] = [];
    const adapter: AgentCenterRuntimeAdapter = createRuntimeAgentCenterAdapter({
      identity: {
        ownerUserId: 'owner',
        runtimeSourceRef: 'agent',
        localAgentRef: 'local-agent:owner:agent',
      },
      agentAIConfig: {
        async get(input) {
          expect(input.localAgentRef).toBe('local-agent:owner:agent');
          calls.push('config.get');
          return { revision: 2, intents: {}, updatedAt: null, updatedByAppId: 'runtime' };
        },
        async upsert() {
          calls.push('config.upsert');
          return { revision: 3, intents: {}, updatedAt: null, updatedByAppId: 'runtime' };
        },
        async readiness(input) {
          expect(input.localAgentRef).toBe('local-agent:owner:agent');
          calls.push('config.readiness');
          return { configRevision: 2, capabilities: [] };
        },
        subscribeReadiness() {
          throw new Error('not used');
        },
      },
      inspect: {
        async getPublicInspect() {
          calls.push('inspect.getPublicInspect');
          return {
            lifecycleStatus: 'active',
            executionState: 'idle',
            statusText: 'ready',
            activeWorldId: null,
            activeUserId: null,
            updatedAt: null,
            currentEmotion: 'calm',
            proactiveInterruptibility: null,
            presentationProfile: null,
            autonomyMode: 'low',
            autonomyEnabled: true,
            autonomyBudgetExhausted: false,
            autonomyUsedTokensInWindow: 0,
            autonomyDailyTokenBudget: 1000,
            autonomyMaxTokensPerHook: 120,
            autonomyWindowStartedAt: null,
            autonomySuspendedUntil: null,
            pendingHooksCount: 0,
            nextScheduledFor: null,
            pendingHooks: [],
            recentTerminalHooks: [],
            recentCanonicalMemories: [],
          } as never;
        },
        async setAutonomyConfig() {
          calls.push('inspect.setAutonomyConfig');
          return { mode: 'low', enabled: true } as never;
        },
      } as never,
      async loadMemory(identity) {
        calls.push(`memory.${identity.localAgentRef}`);
        return { recordCount: 0, records: [] } as never;
      },
      async loadSourceContextStatus(identity) {
        calls.push(`source.${identity.localAgentRef}`);
        return {
          schemaVersion: 'v2',
          ready: false,
          state: 'not_materialized',
          reasonCode: 'source_not_materialized',
          localAgentRef: String(identity.localAgentRef),
          sourceRef: null,
          sourceSchemaVersion: null,
          snapshotSchemaVersion: null,
          snapshotHash: null,
          capturedAt: null,
          worldContentHash: null,
          materializationContextHash: null,
          coverageSections: [],
        };
      },
      async loadTurnContextSummary(input) {
        calls.push(`context.${input.localAgentRef}.${input.conversationAnchorId}`);
        return null;
      },
    });

    const snapshot = await adapter.loadSnapshot({ conversationAnchorId: 'anchor-1' });
    await adapter.upsertAgentAIConfig?.({
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      expectedRevision: 2,
      intents: {
        'text.generate': { route: 'local', modelId: 'local/default' },
        'text.embed': { route: 'local', modelId: 'local/default-embedding' },
      },
    });
    await adapter.setAutonomyConfig?.({
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      mode: 'low',
      dailyTokenBudget: 1000,
      maxTokensPerHook: 120,
    });

    expect(snapshot.agentAIConfig?.revision).toBe(2);
    expect(snapshot.readiness?.configRevision).toBe(2);
    expect(snapshot.sourceContextStatus?.state).toBe('not_materialized');
    expect(snapshot.turnContextSummary).toBeNull();
    expect(calls).toEqual([
      'config.get',
      'config.readiness',
      'inspect.getPublicInspect',
      'memory.local-agent:owner:agent',
      'source.local-agent:owner:agent',
      'context.local-agent:owner:agent.anchor-1',
      'config.upsert',
      'inspect.setAutonomyConfig',
    ]);
  });

  it('enables Runtime autonomy after applying a non-quiet config from an off state', async () => {
    const calls: string[] = [];
    const adapter: AgentCenterRuntimeAdapter = createRuntimeAgentCenterAdapter({
      identity: {
        ownerUserId: 'owner',
        runtimeSourceRef: 'agent',
        localAgentRef: 'local-agent:owner:agent',
      },
      agentAIConfig: {
        async get() {
          throw new Error('not used');
        },
        async upsert() {
          throw new Error('not used');
        },
        async readiness() {
          throw new Error('not used');
        },
        subscribeReadiness() {
          throw new Error('not used');
        },
      },
      inspect: {
        async setAutonomyConfig(input) {
          calls.push(`set.${input.mode}.${input.dailyTokenBudget}.${input.maxTokensPerHook}`);
          return {
            enabled: false,
            mode: input.mode,
            dailyTokenBudget: Number(input.dailyTokenBudget),
            maxTokensPerHook: Number(input.maxTokensPerHook),
          } as never;
        },
        async enableAutonomy(input) {
          calls.push(`enable.${input.localAgentRef}`);
          return {
            enabled: true,
            mode: 'high',
            dailyTokenBudget: 640,
            maxTokensPerHook: 160,
          } as never;
        },
      } as never,
    });

    const snapshot = await adapter.setAutonomyConfig?.({
      enabled: true,
      mode: 'high',
      dailyTokenBudget: 640,
      maxTokensPerHook: 160,
    });

    expect(snapshot?.enabled).toBe(true);
    expect(snapshot?.mode).toBe('high');
    expect(calls).toEqual([
      'set.high.640.160',
      'enable.local-agent:owner:agent',
    ]);
  });

  it('keeps production source behind Kit sdk-contract and typed adapter boundary', () => {
    const root = path.resolve(__dirname, '../src');
    const source = collectSourceFiles(root)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/from ['"]@nimiplatform\/sdk/);
    expect(source).not.toContain(['runtime', 'internal'].join('/'));
    expect(source).not.toContain(['apps', ''].join('/'));
    expect(source).toContain('@nimiplatform/kit/core/sdk-contract');
    expect(source).toContain('AgentCenterRuntimeAdapter');
    expect(source).toContain('AgentCenterAppearanceAdapter');
  });
});
