import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAgentIdentityAutonomyModeLabel,
  resolveAgentIdentityRuntimeActivityLabel,
  resolveAgentIdentityRuntimeStatusLabel,
} from '../src/shell/renderer/features/chat/chat-agent-identity-card-model.js';

test('agent identity card prefers runtime statusText when present', () => {
  assert.equal(resolveAgentIdentityRuntimeStatusLabel({
    lifecycleStatus: 'active',
    executionState: 'life-pending',
    statusText: 'Out exploring',
    activeWorldId: null,
    activeUserId: null,
    autonomyMode: 'medium',
    autonomyEnabled: true,
    autonomyBudgetExhausted: false,
    autonomyUsedTokensInWindow: 12,
    autonomyDailyTokenBudget: 20,
    autonomyMaxTokensPerHook: 120,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: [],
  }), 'Out exploring');
});

test('agent identity card falls back to execution and lifecycle labels when statusText is absent', () => {
  assert.equal(resolveAgentIdentityRuntimeStatusLabel({
    lifecycleStatus: 'active',
    executionState: 'life-pending',
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    autonomyMode: 'low',
    autonomyEnabled: false,
    autonomyBudgetExhausted: false,
    autonomyUsedTokensInWindow: 0,
    autonomyDailyTokenBudget: 10,
    autonomyMaxTokensPerHook: 120,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: [],
  }), 'Life pending');
  assert.equal(resolveAgentIdentityRuntimeStatusLabel({
    lifecycleStatus: 'terminating',
    executionState: null,
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    autonomyMode: 'off',
    autonomyEnabled: false,
    autonomyBudgetExhausted: false,
    autonomyUsedTokensInWindow: 0,
    autonomyDailyTokenBudget: 0,
    autonomyMaxTokensPerHook: 0,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: [],
  }), 'Terminating');
});

test('agent identity card exposes runtime activity when it adds execution or lifecycle context', () => {
  assert.equal(resolveAgentIdentityRuntimeActivityLabel({
    lifecycleStatus: 'active',
    executionState: 'life-pending',
    statusText: 'Out exploring',
    activeWorldId: null,
    activeUserId: null,
    autonomyMode: 'medium',
    autonomyEnabled: true,
    autonomyBudgetExhausted: false,
    autonomyUsedTokensInWindow: 12,
    autonomyDailyTokenBudget: 20,
    autonomyMaxTokensPerHook: 120,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: [],
  }), 'Life pending · Active');
  assert.equal(resolveAgentIdentityRuntimeActivityLabel({
    lifecycleStatus: 'active',
    executionState: 'idle',
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    autonomyMode: 'off',
    autonomyEnabled: false,
    autonomyBudgetExhausted: false,
    autonomyUsedTokensInWindow: 0,
    autonomyDailyTokenBudget: 0,
    autonomyMaxTokensPerHook: 0,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: [],
  }), 'Idle · Active');
  assert.equal(resolveAgentIdentityRuntimeActivityLabel({
    lifecycleStatus: 'terminating',
    executionState: null,
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    autonomyMode: 'off',
    autonomyEnabled: false,
    autonomyBudgetExhausted: false,
    autonomyUsedTokensInWindow: 0,
    autonomyDailyTokenBudget: 0,
    autonomyMaxTokensPerHook: 0,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: [],
  }), null);
});

test('agent identity card exposes autonomy mode label when available', () => {
  assert.equal(resolveAgentIdentityAutonomyModeLabel({ autonomyMode: 'off' } as never), 'Off');
  assert.equal(resolveAgentIdentityAutonomyModeLabel({ autonomyMode: 'medium' } as never), 'Medium');
  assert.equal(resolveAgentIdentityAutonomyModeLabel(null), null);
});
