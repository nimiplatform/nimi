import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type {
  GetRuntimeHealthResponse,
  StreamScenarioEvent,
} from '../core-generated/runtime-typed-client';
import {
  CharacterSourceKindV3,
  FinishReason,
  RealmSourceMaterializationReasonCode,
  RoutePolicy,
  RuntimeHealthStatus,
  StreamEventType,
  WorldEntityRefKindV3,
} from '../core-generated/runtime-typed-client';
import { ReasonCode, type CoreStreamRequest, type CoreUnaryRequest } from '../types';
import { Runtime, createRuntime } from './index';

class FakeRuntimeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];
  readonly streamCalls: CoreStreamRequest[] = [];
  health: GetRuntimeHealthResponse = {
    status: RuntimeHealthStatus.READY,
    reason: 'ok',
  };
  responseMetadata?: Record<string, string>;
  materializationResponse = {
    localAgentRef: 'local-agent:materialized-world-character',
    idempotentReplay: false,
    reasonCode: RealmSourceMaterializationReasonCode.NONE,
  };

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (this.responseMetadata) {
      request.responseMetadataObserver?.(this.responseMetadata);
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth') {
      return this.health as Response;
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario') {
      return {
        finishReason: FinishReason.STOP,
        routeDecision: RoutePolicy.LOCAL,
      } as Response;
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/PeekScheduling') {
      return {
        targetJudgements: [],
      } as Response;
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeAccountService/BeginLogin') {
      return {
        accepted: true,
        loginAttemptId: 'login-1',
      } as Response;
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeArtifactService/CleanupGeneratedVoiceArtifacts') {
      return {
        deletedCount: 1,
        deletedArtifactIds: ['voice-artifact-1'],
      } as Response;
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource') {
      return this.materializationResponse as Response;
    }
    throw Object.assign(new Error(`unexpected unary ${request.methodId}`), {
      code: 'unexpected_runtime_unary',
    });
  }

  async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
    this.streamCalls.push(request);
    if (this.responseMetadata) {
      request.responseMetadataObserver?.(this.responseMetadata);
    }
    if (request.methodId !== '/nimi.runtime.v1.RuntimeAiService/StreamScenario') {
      throw Object.assign(new Error(`unexpected stream ${request.methodId}`), {
        code: 'unexpected_runtime_stream',
      });
    }
    yield {
      eventType: StreamEventType.STREAM_EVENT_STARTED,
    } satisfies StreamScenarioEvent as Response;
    yield {
      eventType: StreamEventType.STREAM_EVENT_COMPLETED,
    } satisfies StreamScenarioEvent as Response;
  }
}

test('Runtime facade exposes active typed namespaces over generated Runtime core', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = createRuntime({
    transport,
    authMetadata: () => ({ 'x-nimi-access-token-id': 'test-token-id' }),
  });

  assert.equal(typeof runtime.ai.executeScenario, 'function');
  assert.equal(typeof runtime.account.beginLogin, 'function');
  assert.equal(typeof runtime.connectors.listProviderCatalog, 'function');
  assert.equal(typeof runtime.scheduling.peekScheduling, 'function');
  assert.equal(typeof runtime.knowledge.searchHybrid, 'function');
  assert.equal(typeof runtime.memory.subscribeMemoryEvents, 'function');
  assert.equal(typeof runtime.local.resolveLocalEnvironmentPlan, 'function');
  assert.equal('getProductControlRecord' in runtime.local, false);
  assert.equal('reconcileProductControlFirstRunSetupState' in runtime.local, false);
  assert.equal(typeof runtime.appMessages.sendAppMessage, 'function');
  assert.equal(typeof runtime.artifacts.cleanupGeneratedVoiceArtifacts, 'function');

  const response = await runtime.ai.executeScenario(
    {},
    { metadata: { 'x-nimi-caller': 'sdk-vnext-test' }, timeoutMs: 123 },
  );

  assert.equal(response.finishReason, FinishReason.STOP);
  assert.equal(response.routeDecision, RoutePolicy.LOCAL);
  assert.equal(transport.unaryCalls[0]?.methodId, '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario');
  assert.equal(transport.unaryCalls[0]?.metadata?.appId, 'nimi.app');
  assert.equal(transport.unaryCalls[0]?.metadata?.['x-nimi-access-token-id'], 'test-token-id');
  assert.equal(transport.unaryCalls[0]?.metadata?.['x-nimi-caller'], 'sdk-vnext-test');
  assert.equal(transport.unaryCalls[0]?.timeoutMs, 123);

  await runtime.scheduling.peekScheduling({ appId: 'app', targets: [] });
  assert.equal(transport.unaryCalls[1]?.methodId, '/nimi.runtime.v1.RuntimeAiService/PeekScheduling');

  const cleanup = await runtime.artifacts.cleanupGeneratedVoiceArtifacts({ agentId: 'agent-1' });
  assert.deepEqual(cleanup.deletedArtifactIds, ['voice-artifact-1']);
  assert.equal(transport.unaryCalls[2]?.methodId, '/nimi.runtime.v1.RuntimeArtifactService/CleanupGeneratedVoiceArtifacts');
});

test('Runtime raw AIConfig namespaces reject retired Local loadout references before transport', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = createRuntime({ transport });
  const retiredLocalIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: { loadoutRef: 'loadout.legacy' } },
  };

  await assert.rejects(
    () => runtime.ai.overwriteAppAIConfig({
      config: { capabilities: [retiredLocalIntent] }, expectedRevision: '0',
    } as never),
    /must not contain a Loadout reference/u,
  );
  await assert.rejects(
    () => runtime.agents.overwriteSharedLocalAgentAIConfig({
      capabilities: [retiredLocalIntent], expectedRevision: '0',
    } as never),
    /must not contain a Loadout reference/u,
  );
  assert.equal(transport.unaryCalls.length, 0);
});

test('Runtime facade materializes a Realm source from sourceRef and requestId only', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = createRuntime({
    appId: 'app.materialization-consumer',
    getSubjectUserId: () => 'account-1',
    transport,
  });
  const sourceRef = {
    kind: 'worldCharacter' as const,
    id: 'character-1',
    worldId: 'world-1',
    worldEntityRef: {
      kind: 'worldEntity' as const,
      worldId: 'world-1',
      entityId: 'entity-1',
    },
    sourceHash: 'a'.repeat(64),
  };

  const response = await runtime.materializeRealmSource({
    sourceRef,
    requestId: 'materialize-request-1',
  });

  assert.equal(response.localAgentRef, 'local-agent:materialized-world-character');
  assert.equal(response.reasonCode, RealmSourceMaterializationReasonCode.NONE);
  assert.equal('materializeRealmSource' in runtime.generated, false);
  assert.equal('materializeRealmSource' in runtime.agents, false);
  assert.equal(transport.unaryCalls.length, 1);
  assert.equal(
    transport.unaryCalls[0]?.methodId,
    '/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource',
  );
  assert.deepEqual(transport.unaryCalls[0]?.body, {
    context: {
      appId: 'app.materialization-consumer',
      subjectUserId: 'account-1',
      ownerUserId: 'account-1',
      runtimeSourceRef: '',
      localAgentRef: '',
    },
    requestId: 'materialize-request-1',
    sourceRef: {
      source: {
        oneofKind: 'worldCharacter',
        worldCharacter: {
          kind: CharacterSourceKindV3.WORLD_CHARACTER,
          id: 'character-1',
          worldId: 'world-1',
          worldEntityRef: {
            kind: WorldEntityRefKindV3.WORLD_ENTITY,
            worldId: 'world-1',
            entityId: 'entity-1',
          },
          sourceHash: 'a'.repeat(64),
        },
      },
    },
  });
});

test('Runtime facade rejects a negative Realm source materialization response as structured Runtime failure', async () => {
  const transport = new FakeRuntimeTransport();
  transport.materializationResponse = {
    localAgentRef: '',
    idempotentReplay: false,
    reasonCode: RealmSourceMaterializationReasonCode.ACQUISITION_DENIED,
  };
  const runtime = createRuntime({
    appId: 'app.materialization-consumer',
    getSubjectUserId: () => 'account-1',
    transport,
  });

  await assert.rejects(
    runtime.materializeRealmSource({
      sourceRef: {
        kind: 'worldCharacter',
        id: 'character-1',
        worldId: 'world-1',
        worldEntityRef: {
          kind: 'worldEntity',
          worldId: 'world-1',
          entityId: 'entity-1',
        },
        sourceHash: 'a'.repeat(64),
      },
      requestId: 'materialize-request-rejected',
    }),
    (error: unknown) => {
      const structured = error as {
        reasonCode?: string;
        actionHint?: string;
        source?: string;
      };
      assert.equal(
        structured.reasonCode,
        'REALM_SOURCE_MATERIALIZATION_REASON_CODE_ACQUISITION_DENIED',
      );
      assert.equal(structured.actionHint, 'inspect_realm_source_materialization_failure');
      assert.equal(structured.source, 'runtime');
      return true;
    },
  );
});

test('Runtime facade materialization fails closed without injected subject context', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = createRuntime({ transport });

  await assert.rejects(
    runtime.materializeRealmSource({
      sourceRef: {
        kind: 'personaCharacter',
        id: 'persona-1',
        worldId: 'world-1',
        ownerAccountId: 'account-1',
        sourceHash: 'b'.repeat(64),
      },
      requestId: 'materialize-request-2',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_SUBJECT_REQUIRED',
  );
  assert.equal(transport.unaryCalls.length, 0);
});

test('Runtime facade rejects invalid source branch, world binding, and source hash before transport', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = createRuntime({
    getSubjectUserId: () => 'account-1',
    transport,
  });
  const invalidSourceRefs: unknown[] = [
    {
      source: {
        oneofKind: 'personaCharacter',
        personaCharacter: {},
      },
    },
    {
      kind: 'worldCharacter',
      id: 'character-1',
      worldId: 'world-1',
      worldEntityRef: {
        kind: 'worldEntity',
        worldId: 'world-2',
        entityId: 'entity-1',
      },
      sourceHash: 'a'.repeat(64),
    },
    {
      kind: 'personaCharacter',
      id: 'persona-1',
      worldId: 'world-1',
      ownerAccountId: 'account-1',
      sourceHash: 'A'.repeat(64),
    },
  ];

  for (const sourceRef of invalidSourceRefs) {
    await assert.rejects(
      runtime.materializeRealmSource({
        sourceRef,
        requestId: 'invalid-source-ref',
      } as never),
      (error: unknown) =>
        (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_REALM_SOURCE_INPUT_INVALID',
    );
  }
  assert.equal(transport.unaryCalls.length, 0);
});

test('Runtime facade streams through generated server-stream methods without reconnect semantics', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = new Runtime({ transport });

  const events = [];
  for await (const event of runtime.ai.streamScenario({})) {
    events.push(event.eventType);
  }

  assert.deepEqual(events, [StreamEventType.STREAM_EVENT_STARTED, StreamEventType.STREAM_EVENT_COMPLETED]);
  assert.equal(transport.streamCalls[0]?.methodId, '/nimi.runtime.v1.RuntimeAiService/StreamScenario');
});

test('Runtime ready fails closed unless Runtime health is explicitly ready', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = new Runtime({ transport });

  assert.equal((await runtime.ready()).status, RuntimeHealthStatus.READY);

  transport.health = {
    status: RuntimeHealthStatus.DEGRADED,
    reason: 'provider unavailable',
  };

  await assert.rejects(
    runtime.ready(),
    (error: unknown) => {
      const shaped = error as { code?: string; health?: GetRuntimeHealthResponse };
      assert.equal(shaped.code, 'RUNTIME_UNAVAILABLE');
      assert.equal(shaped.health?.status, RuntimeHealthStatus.DEGRADED);
      return true;
    },
  );
});

test('Runtime caches response metadata version and exposes compatibility status', async () => {
  const transport = new FakeRuntimeTransport();
  transport.responseMetadata = { 'x-nimi-runtime-version': '0.3.0' };
  const observedMetadata: Array<Record<string, string>> = [];
  const runtime = new Runtime({
    transport,
    responseMetadataObserver: (metadata) => {
      observedMetadata.push({ ...metadata });
    },
  });

  assert.equal(runtime.runtimeVersion(), null);
  assert.equal(runtime.versionCompatibility().state, 'unknown');

  await runtime.ready();

  assert.equal(runtime.runtimeVersion(), '0.3.0');
  assert.deepEqual(runtime.versionCompatibility(), {
    state: 'compatible',
    compatible: true,
    checked: true,
    sdkRuntimeMajor: 0,
    runtimeVersion: '0.3.0',
    runtimeMajor: 0,
  });
  assert.deepEqual(observedMetadata, [{ 'x-nimi-runtime-version': '0.3.0' }]);
});

test('Runtime fails closed on incompatible Runtime major version metadata', async () => {
  const transport = new FakeRuntimeTransport();
  transport.responseMetadata = { 'x-nimi-runtime-version': '1.0.0' };
  const runtime = new Runtime({ transport });

  await assert.rejects(
    runtime.ready(),
    (error: unknown) => {
      const shaped = error as { code?: string; reasonCode?: string };
      assert.equal(shaped.code, 'SDK_RUNTIME_VERSION_INCOMPATIBLE');
      assert.equal(shaped.reasonCode, 'SDK_RUNTIME_VERSION_INCOMPATIBLE');
      return true;
    },
  );

  assert.equal(runtime.runtimeVersion(), '1.0.0');
  assert.equal(runtime.versionCompatibility().state, 'incompatible');
  assert.equal(runtime.versionCompatibility().reason, 'major_mismatch');
});

test('Runtime facade blocks origin-only methods and routes scoped artifact reads to transport enforcement', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = new Runtime({ transport });
  const generated = runtime.generated as unknown as Record<string, unknown>;

  assert.equal('core' in runtime, false);
  assert.equal('unsafeRawTransport' in runtime, false);
  assert.equal(Object.getPrototypeOf(runtime.generated), null);
  assert.equal(Object.isFrozen(runtime.generated), true);
  for (const privateMethod of [
    'createSourceMaterializationChallenge',
    'beginSourceMaterializationUpload',
    'putSourceMaterializationChunk',
    'commitSourceMaterialization',
    'abortSourceMaterializationUpload',
  ]) {
    assert.equal(privateMethod in generated, false);
  }
  assert.equal('generate' in runtime, false);
  assert.equal('stream' in runtime, false);
  assert.equal('workflow' in runtime, false);
  assert.equal('model' in runtime, false);

  await assert.rejects(
    runtime.generated.uploadArtifact({}),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_METHOD_UNAVAILABLE',
  );
  await assert.rejects(
    runtime.generated.openDesktopSession({}),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
  );
  assert.equal(transport.unaryCalls.length, 0);

  for (const invoke of [
    () => runtime.generated.readArtifactBytes({ artifactId: 'artifact-1' }),
    () => runtime.artifacts.readArtifactBytes({ artifactId: 'artifact-1' }),
  ]) {
    await assert.rejects(
      invoke(),
      (error: unknown) => (error as { code?: string }).code === 'unexpected_runtime_unary',
    );
  }
  assert.deepEqual(
    transport.unaryCalls.map((call) => call.methodId),
    [
      '/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes',
      '/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes',
    ],
  );
});
