import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { DependencyResolver } from '../src/runtime/execution-kernel/dependency/dependency-resolver.js';
import { RegistryGateway } from '../src/runtime/execution-kernel/discovery/registry-gateway.js';
import { assertActionDescriptorFinalState } from '../src/runtime/hook/action-fabric/descriptor-validator.js';
import { PermissionGateway } from '../src/runtime/hook/permission/permission-gateway.js';
import { normalizeSourceType } from '../src/runtime/hook/services/utils.js';

function createManifest(input: {
  id?: string;
  dependencies?: string[];
}) {
  return {
    id: input.id || 'mod.example',
    version: '1.0.0',
    capabilities: [],
    dependencies: input.dependencies || [],
    entry: 'index.js',
  };
}

test('dependency resolver detects transitive cycles through installed dependencies', () => {
  const resolver = new DependencyResolver();
  resolver.registerInstalled('dep-b', '1.0.0', ['dep-c']);
  resolver.registerInstalled('dep-c', '1.0.0', ['mod-a']);

  const result = resolver.resolve(createManifest({
    id: 'mod-a',
    dependencies: ['dep-b'],
  }));

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasonCodes, ['DEPENDENCY_CIRCULAR:mod-a -> dep-b -> dep-c -> mod-a']);
});

test('dependency resolver topologically orders direct dependencies using installed graph edges', () => {
  const resolver = new DependencyResolver();
  resolver.registerInstalled('dep-b', '1.0.0', ['dep-c']);
  resolver.registerInstalled('dep-c', '1.0.0', []);

  const result = resolver.resolve(createManifest({
    dependencies: ['dep-b', 'dep-c'],
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.resolved?.map((item) => item.id),
    ['dep-c', 'dep-b'],
  );
});

test('descriptor validator fails closed on unknown verifyPolicy values', () => {
  assert.throws(
    () => assertActionDescriptorFinalState('action.test', {
      actionId: 'action.test',
      inputSchema: {},
      outputSchema: {},
      operation: 'read',
      riskLevel: 'low',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: true,
      verifyPolicy: 'requried' as 'required',
    }),
    /unknown verifyPolicy=requried/,
  );
});

test('permission gateway no longer treats substring matches as protected capabilities', () => {
  const gateway = new PermissionGateway();

  const falsePositive = gateway.evaluate({
    modId: 'mod.example',
    sourceType: 'sideload',
    capabilityKey: 'runtime.economy-writeback.read',
  });
  assert.equal(falsePositive.allow, false);
  assert.deepEqual(falsePositive.reasonCodes, ['HOOK_PERMISSION_DENIED']);

  const protectedCapability = gateway.evaluate({
    modId: 'mod.example',
    sourceType: 'sideload',
    capabilityKey: 'audit.read.all.records',
  });
  assert.equal(protectedCapability.allow, false);
  assert.deepEqual(protectedCapability.reasonCodes, ['CAPABILITY_GRANT_MISSING']);
});

test('normalizeSourceType preserves codegen source types', () => {
  assert.equal(normalizeSourceType('codegen'), 'codegen');
});

test('registry gateway rejects empty discovery source refs', () => {
  const gateway = new RegistryGateway();
  assert.deepEqual(
    gateway.verifySource('sideload', '   '),
    { ok: false, reasonCode: ReasonCode.DISCOVERY_SOURCE_UNTRUSTED },
  );
});
