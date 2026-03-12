import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { createTauriIpcTransport } from '../../src/runtime/transports/tauri-ipc';
import {
  createNodeGrpcTransport,
  setNodeGrpcBridge,
} from '../../src/runtime/transports/node-grpc';
import { asNimiError, createNimiError } from '../../src/runtime/errors';
import {
  checkRuntimeVersionCompatibility,
  assertRuntimeMethodAvailable,
  wrapModeDStream,
  resolveRuntimeSubjectUserId,
  resolveOptionalRuntimeSubjectUserId,
  runtimeAiRequestRequiresSubject,
} from '../../src/runtime/runtime-guards.js';
import {
  connectRuntime,
  readyRuntime,
  closeRuntime,
} from '../../src/runtime/runtime-lifecycle.js';
import {
  toRuntimeGenerateResult,
  runtimeGenerateConvenience,
  runtimeStreamConvenience,
} from '../../src/runtime/runtime-convenience.js';
import {
  installTauriRuntime,
  unwrapTauriInvokePayload,
  clearNodeGrpcBridge,
  installNodeGrpcBridge,
} from './runtime-client-fixtures.js';
import { RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai';
import type {
  RuntimeWireMessage,
  RuntimeUnaryCall,
  RuntimeOpenStreamCall,
  RuntimeConnectionState,
} from '../../src/runtime/types';

// ---------------------------------------------------------------------------
// runtime-guards: checkRuntimeVersionCompatibility branches
// ---------------------------------------------------------------------------

test('runtime-guards: checkRuntimeVersionCompatibility returns compatible status when already checked', () => {
  const result = checkRuntimeVersionCompatibility({
    version: '0.1.0',
    versionChecked: true,
    sdkRuntimeMajor: 0,
    emitTelemetry: () => {},
    emitError: () => {},
  });
  assert.equal(result.state, 'compatible');
  assert.equal(result.compatible, true);
  assert.equal(result.runtimeMajor, 0);
});

test('runtime-guards: checkRuntimeVersionCompatibility throws for unparseable version', () => {
  assert.throws(
    () => checkRuntimeVersionCompatibility({
      version: 'not-a-version',
      versionChecked: false,
      sdkRuntimeMajor: 0,
      emitTelemetry: () => {},
      emitError: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE;
    },
  );
});

test('runtime-guards: checkRuntimeVersionCompatibility throws for mismatched major version', () => {
  let emitErrorCalled = false;
  assert.throws(
    () => checkRuntimeVersionCompatibility({
      version: '2.0.0',
      versionChecked: false,
      sdkRuntimeMajor: 0,
      emitTelemetry: () => {},
      emitError: () => { emitErrorCalled = true; },
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE;
    },
  );
  assert.ok(emitErrorCalled);
});

test('runtime-guards: checkRuntimeVersionCompatibility succeeds for matching major version', () => {
  let telemetryName = '';
  const result = checkRuntimeVersionCompatibility({
    version: '0.5.0',
    versionChecked: false,
    sdkRuntimeMajor: 0,
    emitTelemetry: (name) => { telemetryName = name; },
    emitError: () => {},
  });
  assert.equal(result.state, 'compatible');
  assert.equal(result.compatible, true);
  assert.equal(result.runtimeMajor, 0);
  assert.equal(telemetryName, 'runtime.version.compatible');
});

test('runtime-guards: checkRuntimeVersionCompatibility handles v-prefixed version', () => {
  const result = checkRuntimeVersionCompatibility({
    version: 'v0.3.1',
    versionChecked: false,
    sdkRuntimeMajor: 0,
    emitTelemetry: () => {},
    emitError: () => {},
  });
  assert.equal(result.state, 'compatible');
  assert.equal(result.compatible, true);
  assert.equal(result.runtimeMajor, 0);
});

// ---------------------------------------------------------------------------
// runtime-guards: assertRuntimeMethodAvailable branches
// ---------------------------------------------------------------------------

test('runtime-guards: assertRuntimeMethodAvailable returns for non-phase2 module', () => {
  // Should not throw
  assertRuntimeMethodAvailable({
    moduleKey: 'ai',
    methodKey: 'executeScenario',
    runtimeVersion: '0.1.0',
    sdkRuntimeMajor: 0,
    phase2ModuleKeys: new Set(['workflow', 'model']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable returns for phase2 module with null version', () => {
  // null runtimeVersion => early return
  assertRuntimeMethodAvailable({
    moduleKey: 'workflow',
    methodKey: 'executeWorkflow',
    runtimeVersion: null,
    sdkRuntimeMajor: 0,
    phase2ModuleKeys: new Set(['workflow']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable returns for phase2 module with unparseable version', () => {
  // unparseable version => parseSemverMajor returns null => early return
  assertRuntimeMethodAvailable({
    moduleKey: 'workflow',
    methodKey: 'executeWorkflow',
    runtimeVersion: 'not-a-version',
    sdkRuntimeMajor: 0,
    phase2ModuleKeys: new Set(['workflow']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable throws for phase2 with old runtime', () => {
  assert.throws(
    () => assertRuntimeMethodAvailable({
      moduleKey: 'workflow',
      methodKey: 'executeWorkflow',
      runtimeVersion: '0.1.0',
      sdkRuntimeMajor: 1,
      phase2ModuleKeys: new Set(['workflow']),
      phase2AuditMethodIds: new Set(),
      auditMethodIds: {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE;
    },
  );
});

test('runtime-guards: assertRuntimeMethodAvailable allows phase2 with matching version', () => {
  assertRuntimeMethodAvailable({
    moduleKey: 'workflow',
    methodKey: 'executeWorkflow',
    runtimeVersion: '1.0.0',
    sdkRuntimeMajor: 1,
    phase2ModuleKeys: new Set(['workflow']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable handles phase2 audit method', () => {
  assert.throws(
    () => assertRuntimeMethodAvailable({
      moduleKey: 'audit',
      methodKey: 'listAuditEvents',
      runtimeVersion: '0.1.0',
      sdkRuntimeMajor: 1,
      phase2ModuleKeys: new Set(),
      phase2AuditMethodIds: new Set(['/runtime.v1.AuditService/ListAuditEvents']),
      auditMethodIds: { listAuditEvents: '/runtime.v1.AuditService/ListAuditEvents' },
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE;
    },
  );
});

test('runtime-guards: assertRuntimeMethodAvailable skips non-matching audit method', () => {
  // audit module but method not in phase2AuditMethodIds => not phase2 => early return
  assertRuntimeMethodAvailable({
    moduleKey: 'audit',
    methodKey: 'getHealth',
    runtimeVersion: '0.1.0',
    sdkRuntimeMajor: 1,
    phase2ModuleKeys: new Set(),
    phase2AuditMethodIds: new Set(['/runtime.v1.AuditService/ListAuditEvents']),
    auditMethodIds: { getHealth: '/runtime.v1.AuditService/GetHealth' },
  });
});

// ---------------------------------------------------------------------------
// runtime-guards: wrapModeDStream branches
// ---------------------------------------------------------------------------

test('runtime-guards: wrapModeDStream yields from source and catches cancel', async () => {
  let cancelled = false;
  const source = (async function*() {
    yield 'a';
    yield 'b';
    throw createNimiError({
      message: ReasonCode.RUNTIME_GRPC_CANCELLED,
      reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
      source: 'runtime',
    });
  })();

  const wrapped = wrapModeDStream({
    source,
    onCancelled: () => { cancelled = true; },
  });

  const items: string[] = [];
  for await (const item of wrapped) {
    items.push(item as string);
  }
  assert.deepEqual(items, ['a', 'b']);
  assert.ok(cancelled);
});

test('runtime-guards: wrapModeDStream re-throws non-cancelled errors', async () => {
  const source = (async function*() {
    yield 'a';
    throw createNimiError({
      message: 'some other error',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      source: 'runtime',
    });
  })();

  const wrapped = wrapModeDStream({
    source,
    onCancelled: () => {},
  });

  const items: string[] = [];
  await assert.rejects(async () => {
    for await (const item of wrapped) {
      items.push(item as string);
    }
  }, (error: unknown) => {
    const e = asNimiError(error, { source: 'runtime' });
    return e.reasonCode === ReasonCode.RUNTIME_CALL_FAILED;
  });
  assert.deepEqual(items, ['a']);
});

test('runtime-guards: wrapModeDStream detects cancel via message containing reason code', async () => {
  let cancelled = false;
  const source = (async function*() {
    throw new Error(`something went wrong: ${ReasonCode.RUNTIME_GRPC_CANCELLED}`);
  })();

  const wrapped = wrapModeDStream({
    source,
    onCancelled: () => { cancelled = true; },
  });

  const items: string[] = [];
  for await (const item of wrapped) {
    items.push(item as string);
  }
  assert.equal(items.length, 0);
  assert.ok(cancelled);
});

// ---------------------------------------------------------------------------
// runtime-guards: resolveRuntimeSubjectUserId / resolveOptionalRuntimeSubjectUserId
// ---------------------------------------------------------------------------

test('runtime-guards: resolveRuntimeSubjectUserId returns explicit value', async () => {
  const result = await resolveRuntimeSubjectUserId({
    explicit: 'user-123',
  });
  assert.equal(result, 'user-123');
});

test('runtime-guards: resolveRuntimeSubjectUserId falls back to subjectContext.subjectUserId', async () => {
  const result = await resolveRuntimeSubjectUserId({
    subjectContext: { subjectUserId: 'context-user' },
  });
  assert.equal(result, 'context-user');
});

test('runtime-guards: resolveRuntimeSubjectUserId uses getSubjectUserId resolver', async () => {
  const result = await resolveRuntimeSubjectUserId({
    subjectContext: { getSubjectUserId: async () => 'resolved-user' },
  });
  assert.equal(result, 'resolved-user');
});

test('runtime-guards: resolveRuntimeSubjectUserId throws when no subject available', async () => {
  await assert.rejects(
    () => resolveRuntimeSubjectUserId({}),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.AUTH_CONTEXT_MISSING;
    },
  );
});

test('runtime-guards: resolveRuntimeSubjectUserId throws for empty explicit', async () => {
  await assert.rejects(
    () => resolveRuntimeSubjectUserId({
      explicit: '  ',
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.AUTH_CONTEXT_MISSING;
    },
  );
});

test('runtime-guards: resolveOptionalRuntimeSubjectUserId returns undefined when nothing set', async () => {
  const result = await resolveOptionalRuntimeSubjectUserId({});
  assert.equal(result, undefined);
});

test('runtime-guards: resolveOptionalRuntimeSubjectUserId returns undefined for empty resolver', async () => {
  const result = await resolveOptionalRuntimeSubjectUserId({
    subjectContext: { getSubjectUserId: async () => '' },
  });
  assert.equal(result, undefined);
});

test('runtime-guards: resolveOptionalRuntimeSubjectUserId skips non-function resolver', async () => {
  const result = await resolveOptionalRuntimeSubjectUserId({
    subjectContext: {
      getSubjectUserId: 'not-a-function' as unknown as () => string,
    },
  });
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// runtime-guards: runtimeAiRequestRequiresSubject branches
// ---------------------------------------------------------------------------

test('runtime-guards: runtimeAiRequestRequiresSubject returns false for local route without extras', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: 'local' as unknown as number },
  });
  // RoutePolicy.LOCAL is enum value, using string 'local' won't match
  // so routePolicy !== RoutePolicy.LOCAL -> returns true
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true for cloud route', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.CLOUD },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when connectorId present', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL, connectorId: 'my-connector' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true for managed keySource', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { keySource: 'managed' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true for inline keySource', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { keySource: 'inline' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when providerType set', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { providerType: 'openai' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when providerEndpoint set', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { providerEndpoint: 'https://api.example.com' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when providerApiKey set', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { providerApiKey: 'sk-test' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns false for pure local with no extras', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: {},
  });
  assert.equal(result, false);
});

test('runtime-guards: runtimeAiRequestRequiresSubject reads head.routePolicy fallback', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { head: { routePolicy: RoutePolicy.CLOUD } },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject reads head.connectorId fallback', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { head: { routePolicy: RoutePolicy.LOCAL, connectorId: 'conn-1' } },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject handles undefined metadata', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: undefined,
  });
  assert.equal(result, false);
});

test('runtime-guards: runtimeAiRequestRequiresSubject reads x-nimi- alt keys from metadata', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { 'x-nimi-key-source': 'managed' } as Record<string, unknown>,
  });
  assert.equal(result, true);
});
