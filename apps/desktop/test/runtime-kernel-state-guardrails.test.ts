import assert from 'node:assert/strict';
import test from 'node:test';

import { runUpdateFlow } from '../src/runtime/execution-kernel/kernel/flows/lifecycle-flow.js';
import { LifecycleManager } from '../src/runtime/execution-kernel/lifecycle/lifecycle-manager.js';
import { PolicyEngine } from '../src/runtime/execution-kernel/policy/policy-engine.js';
import { CrashIsolator } from '../src/runtime/execution-kernel/crash-isolator/crash-isolator.js';
import { HookAuditTrail } from '../src/runtime/hook/audit/hook-audit.js';
import { HookRegistry } from '../src/runtime/hook/registry/hook-registry.js';
import { resolveVerifyTicketTtlMs } from '../src/runtime/hook/services/action-service-preflight.js';

test('verify ticket TTL uses default window when ttlSeconds is missing or non-positive', () => {
  assert.equal(resolveVerifyTicketTtlMs(undefined, 15 * 60 * 1000), 15 * 60 * 1000);
  assert.equal(resolveVerifyTicketTtlMs(0, 15 * 60 * 1000), 15 * 60 * 1000);
  assert.equal(resolveVerifyTicketTtlMs(1, 15 * 60 * 1000), 5_000);
  assert.equal(resolveVerifyTicketTtlMs(1200, 15 * 60 * 1000), 900_000);
});

test('update flow cleans up failed target version before rollback enable', async () => {
  const deletedKeys: string[] = [];
  const lifecycleTransitions: Array<string> = [];

  await assert.rejects(
    () => runUpdateFlow({
      update: {
        modId: 'mod.example',
        version: '1.0.0',
        targetVersion: '2.0.0',
        actor: 'tester',
        mode: 'sideload',
      },
      disable: async () => ({ state: 'DISABLED' }),
      install: async () => ({ state: 'INSTALLED' }),
      enable: async ({ version }) => {
        if (version === '2.0.0') {
          throw new Error('ENABLE_FAILED');
        }
        return { state: 'ENABLED' };
      },
      getLifecycle: (_modId, version) => (version === '2.0.0' ? 'INSTALLED' : 'DISABLED'),
      deleteContext: (key) => { deletedKeys.push(key); },
      setLifecycle: (modId, version, state) => { lifecycleTransitions.push(`${modId}@${version}:${state}`); },
      keyFor: (modId, version) => `${modId}@${version}`,
    }),
    /ENABLE_FAILED/,
  );

  assert.deepEqual(deletedKeys, ['mod.example@2.0.0']);
  assert.deepEqual(lifecycleTransitions, ['mod.example@2.0.0:UNINSTALLED']);
});

test('lifecycle manager validates transitions and caps history growth', () => {
  const lifecycle = new LifecycleManager();
  lifecycle.set('mod.example', '1.0.0', 'INSTALLED');

  assert.throws(
    () => lifecycle.set('mod.example', '1.0.0', 'DISCOVERED'),
    /TRANSITION_INVALID:INSTALLED->DISCOVERED/,
  );

  for (let index = 0; index < 150; index += 1) {
    lifecycle.set('mod.example', '1.0.0', index % 2 === 0 ? 'ENABLED' : 'DISABLED');
  }

  assert.equal(lifecycle.getHistory('mod.example', '1.0.0').length, 100);
});

test('hook registry unregisterAll retains removed tombstones for observability', () => {
  const registry = new HookRegistry();
  registry.register({
    modId: 'mod.example',
    hookType: 'event-bus',
    target: 'topic.alpha',
    capabilityKey: 'event.publish.topic.alpha',
    contractId: 'contract.alpha',
    version: 'v1',
    sourceType: 'sideload',
    requestedCapabilities: ['event.publish.topic.alpha'],
  });

  registry.unregisterAll('mod.example');

  const registrations = registry.listRegistrations('mod.example');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.status, 'REMOVED');
  assert.equal(registrations[0]?.statusReason, 'UNREGISTER_ALL');
  assert.equal(registry.listByStatus('REMOVED').length, 1);
});

test('hook audit trail uses a bounded ring buffer and only truncates when limit is explicit', () => {
  const audit = new HookAuditTrail(150);
  for (let index = 0; index < 120; index += 1) {
    audit.append({
      callId: `call-${index}`,
      modId: 'mod.example',
      hookType: 'storage',
      target: `target-${index}`,
      decision: index % 2 === 0 ? 'ALLOW' : 'DENY',
      latencyMs: index,
      reasonCodes: ['TEST'],
      timestamp: new Date(index * 1000).toISOString(),
    });
  }

  assert.equal(audit.size, 120);
  assert.equal(audit.export().length, 120);
  assert.equal(audit.query({}).length, 120);
  assert.equal(audit.query({ limit: 10 }).length, 10);
});

test('policy engine fails closed on unknown access modes', async () => {
  const engine = new PolicyEngine({
    validateGrant: async () => ({ valid: true, reasonCodes: [] }),
  } as never);

  const result = await engine.evaluate({
    modId: 'mod.example',
    mode: 'cloud' as never,
    requestedCapabilities: [],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasonCodes, ['DISCOVERY_MODE_UNKNOWN']);
});

test('crash isolator cooldown check is read-only and report resets expired entries', () => {
  const isolator = new CrashIsolator({ threshold: 2, cooldownMs: 10 });
  const originalNow = Date.now;
  let nowMs = 1_000;
  Date.now = () => nowMs;

  try {
    isolator.report('mod.example');
    isolator.report('mod.example');
    assert.equal(isolator.shouldDisable('mod.example'), true);

    const entries = (isolator as unknown as {
      entries: Map<string, { lastAt: string }>;
    }).entries;
    const entry = entries.get('mod.example');
    assert.ok(entry);
    entry.lastAt = new Date(0).toISOString();
    nowMs = 1_050;
    assert.equal(isolator.shouldDisable('mod.example'), false);
    const statusAfterCooldown = isolator.getStatus('mod.example');
    assert.equal(statusAfterCooldown.crashCount, 2);
    assert.equal(statusAfterCooldown.disabled, false);
    assert.ok(statusAfterCooldown.lastCrashAt);

    const nextCount = isolator.report('mod.example');
    assert.equal(nextCount, 1);
    assert.equal(isolator.shouldDisable('mod.example'), false);
  } finally {
    Date.now = originalNow;
  }
});
