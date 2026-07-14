import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreClient, type CoreTransport } from '../core-client';
import type {
  GetRuntimeHealthResponse,
  StreamScenarioEvent,
} from '../core-generated/runtime-typed-client';
import {
  FinishReason,
  RoutePolicy,
  RuntimeHealthStatus,
  StreamEventType,
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
  assert.equal(typeof runtime.agents.initializeAgent, 'function');
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

test('Runtime facade keeps low-level generated core explicit and high-level deferred promises absent', async () => {
  const transport = new FakeRuntimeTransport();
  const core = new CoreClient({ transport });
  const runtime = new Runtime(core);

  assert.equal(runtime.unsafeRawTransport(), transport);
  assert.equal('generate' in runtime, false);
  assert.equal('stream' in runtime, false);
  assert.equal('workflow' in runtime, false);
  assert.equal('model' in runtime, false);

  await assert.rejects(
    runtime.generated.uploadArtifact({}),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_METHOD_UNAVAILABLE',
  );
  await assert.rejects(
    runtime.generated.installApp({
      appId: 'app.example',
      confirmed: true,
      lifecycleIntentId: 'intent-1',
      displayedImpactDigest: 'impact-digest-1',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_APP_LIFECYCLE_TYPED_CLIENT_REQUIRED',
  );
  await assert.rejects(
    runtime.generated.prepareAppLifecycleIntent({
      action: 1,
      appId: 'app.example',
      expectedReleaseRef: 'release:app.example@1.0.0',
      expectedArtifactDigest: 'digest-1',
      expectedAdoptionGeneration: '0',
    }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_APP_LIFECYCLE_TYPED_CLIENT_REQUIRED',
  );
  await assert.rejects(
    runtime.generated.getAppLifecycleIntentStatus({ intentId: 'intent-1' }),
    (error: unknown) =>
      (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_APP_LIFECYCLE_TYPED_CLIENT_REQUIRED',
  );
  for (const invoke of [
    () => runtime.generated.openDesktopSession({}),
    () => runtime.generated.readArtifactBytes({ artifactId: 'artifact-1' }),
    () => runtime.artifacts.readArtifactBytes({ artifactId: 'artifact-1' }),
  ]) {
    await assert.rejects(
      invoke(),
      (error: unknown) =>
        (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    );
  }
  assert.equal(transport.unaryCalls.length, 0);
});
