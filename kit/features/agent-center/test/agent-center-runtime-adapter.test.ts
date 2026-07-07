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
  it('loads execution config, readiness, inspect, and memory through typed adapters', async () => {
    const calls: string[] = [];
    const adapter: AgentCenterRuntimeAdapter = createRuntimeAgentCenterAdapter({
      identity: {
        ownerUserId: 'owner',
        runtimeSourceRef: 'agent',
        localAgentRef: 'local-agent:owner:agent',
      },
      executionConfig: {
        async get() {
          calls.push('config.get');
          return { revision: 2, bindings: {}, updatedAt: null, updatedByAppId: 'runtime' };
        },
        async upsert() {
          calls.push('config.upsert');
          return { revision: 3, bindings: {}, updatedAt: null, updatedByAppId: 'runtime' };
        },
        async readiness() {
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
    });

    const snapshot = await adapter.loadSnapshot();
    await adapter.upsertExecutionConfig?.({ expectedRevision: 2, bindings: { 'text.generate': { route: 'local', modelId: 'local/default' } } });
    await adapter.setAutonomyConfig?.({
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      mode: 'low',
      dailyTokenBudget: 1000,
      maxTokensPerHook: 120,
    });

    expect(snapshot.executionConfig?.revision).toBe(2);
    expect(snapshot.readiness?.configRevision).toBe(2);
    expect(calls).toEqual([
      'config.get',
      'config.readiness',
      'inspect.getPublicInspect',
      'memory.local-agent:owner:agent',
      'config.upsert',
      'inspect.setAutonomyConfig',
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
