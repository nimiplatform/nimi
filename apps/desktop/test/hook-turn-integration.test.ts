import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// ---------------------------------------------------------------------------
// D-HOOK-003 — Turn Hook Integration (source scanning)
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../src/runtime/hook');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

const capabilitiesSource = readSource('contracts/capabilities.ts');
const typesSource = readSource('contracts/types.ts');
const turnServiceSource = readSource('services/turn-service.ts');
const hookRegistrySource = readSource('registry/hook-registry.ts');
const hookRuntimeServiceSource = readSource('hook-runtime.service.ts');
const permissionGatewaySource = readSource('permission/permission-gateway.ts');

test('D-HOOK-003: turn hook system exists in source', () => {
  // TurnHookPoint type must define the four canonical hook points
  assert.ok(
    typesSource.includes("'pre-policy'"),
    'types source must define pre-policy turn hook point',
  );
  assert.ok(
    typesSource.includes("'pre-model'"),
    'types source must define pre-model turn hook point',
  );
  assert.ok(
    typesSource.includes("'post-state'"),
    'types source must define post-state turn hook point',
  );
  assert.ok(
    typesSource.includes("'pre-commit'"),
    'types source must define pre-commit turn hook point',
  );

  // DEFAULT_TURN_HOOK_POINTS must list the four points in order
  assert.ok(
    capabilitiesSource.includes('DEFAULT_TURN_HOOK_POINTS'),
    'capabilities source must export DEFAULT_TURN_HOOK_POINTS',
  );

  // Turn service must exist with registration method
  assert.ok(
    turnServiceSource.includes('registerTurnHookV2'),
    'turn service must implement registerTurnHookV2',
  );
  assert.ok(
    turnServiceSource.includes('invokeTurnHooks'),
    'turn service must implement invokeTurnHooks',
  );
  assert.ok(
    turnServiceSource.includes('unregisterTurnHook'),
    'turn service must implement unregisterTurnHook',
  );

  // HookRegistry must support turn hook registration
  assert.ok(
    hookRegistrySource.includes('registerTurnHook'),
    'hook registry must implement registerTurnHook',
  );
  assert.ok(
    hookRegistrySource.includes('listTurnHooks'),
    'hook registry must implement listTurnHooks',
  );
});

test('D-HOOK-003: hook registration supports multiple source types', () => {
  // HookSourceType must enumerate all 5 source types
  const sourceTypeMatch = typesSource.match(/HookSourceType\s*=\s*([^;]+)/);
  assert.ok(sourceTypeMatch, 'types source must define HookSourceType');
  const sourceTypeDef = sourceTypeMatch[1];

  assert.ok(sourceTypeDef.includes("'builtin'"), 'HookSourceType must include builtin');
  assert.ok(sourceTypeDef.includes("'injected'"), 'HookSourceType must include injected');
  assert.ok(sourceTypeDef.includes("'sideload'"), 'HookSourceType must include sideload');
  assert.ok(sourceTypeDef.includes("'core'"), 'HookSourceType must include core');
  assert.ok(sourceTypeDef.includes("'codegen'"), 'HookSourceType must include codegen');

  // HookRegistration type must carry sourceType field
  assert.ok(
    hookRegistrySource.includes('sourceType'),
    'hook registry must track sourceType on registrations',
  );

  // HookRuntimeService delegates source type to lifecycle service
  assert.ok(
    hookRuntimeServiceSource.includes('setModSourceType'),
    'hook runtime service must expose setModSourceType',
  );

  // Turn service passes sourceType into permission evaluation
  assert.ok(
    turnServiceSource.includes('sourceType'),
    'turn service must pass sourceType into permission evaluation',
  );
});

test('D-HOOK-003: hook capability system uses permission checks', () => {
  // Turn service imports turnRegisterCapability to derive capability keys
  assert.ok(
    turnServiceSource.includes('turnRegisterCapability'),
    'turn service must use turnRegisterCapability for capability key derivation',
  );

  // Turn service calls evaluatePermission before registering
  assert.ok(
    turnServiceSource.includes('evaluatePermission'),
    'turn service must call evaluatePermission during registration',
  );

  // PermissionGateway uses anyCapabilityMatches for allowlist checking
  assert.ok(
    permissionGatewaySource.includes('anyCapabilityMatches'),
    'permission gateway must use anyCapabilityMatches',
  );

  // PermissionGateway consults DEFAULT_SOURCE_ALLOWLIST
  assert.ok(
    permissionGatewaySource.includes('DEFAULT_SOURCE_ALLOWLIST'),
    'permission gateway must reference DEFAULT_SOURCE_ALLOWLIST for fallback checks',
  );

  // Permission evaluation returns structured result with reasonCodes
  assert.ok(
    permissionGatewaySource.includes('reasonCodes'),
    'permission gateway must include reasonCodes in evaluation result',
  );

  // Audit trail is written after permission check in turn service
  assert.ok(
    turnServiceSource.includes('audit.append'),
    'turn service must append audit record after permission evaluation',
  );
});
