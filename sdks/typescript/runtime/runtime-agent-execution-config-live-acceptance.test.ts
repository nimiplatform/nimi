import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { RuntimeTypedCallOptions } from '../core-generated/runtime-typed-client';

import { withRuntimeAgentLiveE2EFixture } from './runtime-agent-live-e2e-fixture.test-helper';
import { createFixtureRuntimeAgentClient } from './runtime-agent-live-e2e-fixture-runtime.test-helper';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';
import { createNimiRuntimeAppSessionMetadataProvider } from './app-session';
import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';
import { toNimiRuntimeProtoStruct } from './runtime-agent-values';
import type { NimiRuntimeAgentTurnRunnerPart } from './runtime-agent-turn-runner-types';
import type {
  NimiRuntimeAgentExecutionReadinessSnapshotProjection,
} from './runtime-agent-execution-config';

// Live acceptance matrix v1 for the Runtime Agent execution config SDK
// surface (K-AGCORE-144~150, S-RUNTIME-011 runtime.agent.executionConfig.*).
// Config domain only: no agent turns are exercised here.
//
// Deferred (not faked): daemon-restart persistence of the committed config
// (K-AGCORE-145). withRuntimeDaemon spawns one daemon per fixture and removes
// the state root on teardown, so an in-fixture restart against the same
// persistence root is not cleanly supported yet. Runtime-side restart
// persistence is covered by runtime/internal/services/runtimeagent tests.
test('runtime agent execution config live acceptance matrix v1', {
  timeout: 300_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      const agentClient = createFixtureRuntimeAgentClient(fixture.runtime);
      const executionConfig = agentClient.executionConfig;

      // 1. Fresh daemon exposes the K-AGCORE-150 seeded config.
      const seeded = await executionConfig.get();
      assert.ok(seeded.revision >= 1, `seeded revision must be >= 1, got ${seeded.revision}`);
      assert.equal(seeded.updatedByAppId, 'runtime');
      assert.ok(seeded.updatedAt, 'seeded config must carry a commit timestamp');
      const seededText = seeded.bindings['text.generate'];
      assert.ok(seededText, 'seed must commit the text.generate binding');
      assert.equal(seededText.modelId, 'local/default');
      assert.equal(seededText.route, 'local');
      assert.equal(seeded.bindings['image.generate'], undefined, 'seed must leave image.generate absent');

      // 2. Readiness projection: text ready, image not_configured.
      const seededReadiness = await executionConfig.readiness();
      assert.equal(seededReadiness.configRevision, seeded.revision);
      assert.equal(readinessState(seededReadiness, 'text.generate'), 'ready');
      assert.equal(readinessState(seededReadiness, 'image.generate'), 'not_configured');

      // 3. Upsert with the correct expectedRevision adds the fixture cloud
      // image binding: revision advances by exactly one and image readiness
      // leaves not_configured.
      const imageBinding = {
        route: 'cloud' as const,
        modelId: fixture.imageRoute.executionBinding.modelId,
        ...(fixture.imageRoute.executionBinding.connectorId
          ? { connectorId: fixture.imageRoute.executionBinding.connectorId }
          : {}),
        targetRef: fixture.imageRoute.targetRef,
      };
      const committed = await executionConfig.upsert({
        expectedRevision: seeded.revision,
        bindings: {
          'text.generate': seededText,
          'image.generate': imageBinding,
        },
      });
      assert.equal(committed.revision, seeded.revision + 1);
      assert.equal(committed.updatedByAppId, 'nimi.desktop');
      assert.equal(committed.bindings['image.generate']?.route, 'cloud');
      assert.equal(committed.bindings['image.generate']?.modelId, fixture.imageRoute.executionBinding.modelId);
      assert.equal(
        committed.bindings['image.generate']?.connectorId,
        fixture.imageRoute.executionBinding.connectorId,
      );
      assert.deepEqual(committed.bindings['image.generate']?.targetRef, fixture.imageRoute.targetRef);
      assert.equal(committed.bindings['text.generate']?.modelId, 'local/default');

      const committedReadiness = await executionConfig.readiness();
      assert.equal(committedReadiness.configRevision, committed.revision);
      assert.notEqual(
        readinessState(committedReadiness, 'image.generate'),
        'not_configured',
        'a committed image binding must leave not_configured',
      );
      assert.equal(readinessState(committedReadiness, 'text.generate'), 'ready');

      // 4. A stale expectedRevision is a typed concurrent-modification
      // rejection, never a silent last-writer win.
      await assert.rejects(executionConfig.upsert({
        expectedRevision: seeded.revision,
        bindings: {
          'text.generate': seededText,
        },
      }), (error: { readonly reasonCode?: string; readonly actionHint?: string }) => {
        assert.equal(error.reasonCode, 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION');
        assert.equal(error.actionHint, 'reload_committed_execution_config_and_retry');
        return true;
      });
      const afterConflict = await executionConfig.get();
      assert.equal(afterConflict.revision, committed.revision, 'conflicting upsert must not mutate the config');

      // 5. Removing the required text.generate binding is a typed
      // invalid-argument failure (SDK fail-closed pre-check).
      await assert.rejects(executionConfig.upsert({
        expectedRevision: committed.revision,
        bindings: {
          'image.generate': imageBinding,
        },
      }), (error: { readonly reasonCode?: string }) => {
        assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_INPUT_INVALID');
        return true;
      });

      // 6. subscribeReadiness delivers the initial snapshot, then a change
      // snapshot whose configRevision advances after the next mutation.
      const stream = executionConfig.subscribeReadiness();
      const iterator = stream[Symbol.asyncIterator]();
      try {
        const initial = await nextSnapshot(iterator, 'initial readiness snapshot');
        assert.equal(initial.configRevision, committed.revision);
        assert.equal(readinessState(initial, 'text.generate'), 'ready');

        const reverted = await executionConfig.upsert({
          expectedRevision: committed.revision,
          bindings: {
            'text.generate': seededText,
          },
        });
        assert.equal(reverted.revision, committed.revision + 1);

        const deadline = Date.now() + 30_000;
        let advanced: NimiRuntimeAgentExecutionReadinessSnapshotProjection | null = null;
        while (Date.now() < deadline) {
          const snapshot = await nextSnapshot(iterator, 'post-upsert readiness snapshot');
          if (snapshot.configRevision >= reverted.revision) {
            advanced = snapshot;
            break;
          }
        }
        assert.ok(advanced, 'subscription must deliver a snapshot with the advanced configRevision');
        assert.equal(advanced.configRevision, reverted.revision);
        assert.equal(readinessState(advanced, 'image.generate'), 'not_configured');
      } finally {
        await iterator.return?.();
      }
    },
  });
});

// Live acceptance matrix v2 for the atomic turn cutover (K-AGCORE-147):
// public chat turns never carry execution bindings, the committed execution
// config is the only binding truth, and the session snapshot carries the
// admission-resolved bindings plus the config revision fixed at admission.
test('runtime agent turn execution cutover live acceptance matrix v2', {
  timeout: 300_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    // Spread turn event emission across seconds so the app-message loop
    // breaker (20 bidirectional messages/second between one app pair) never
    // classifies the fixture's instant model replies as a message loop.
    localChatCompletionStreamDelayMs: 1_500,
    run: async (fixture) => {
      const agentClient = createFixtureRuntimeAgentClient(fixture.runtime);
      const executionConfig = agentClient.executionConfig;
      const identity = {
        ownerUserId: fixture.ownerUserId,
        runtimeSourceRef: fixture.runtimeSourceRef,
        localAgentRef: fixture.localAgentRef,
      };
      const runTurn = async (text: string) => {
        try {
          return await runFixtureTurnAndCollectEvents({
            agentClient,
            identity,
            conversationAnchorId: fixture.conversationAnchorId,
            text,
            timeoutMs: 30_000,
          });
        } catch (error) {
          throw error;
        }
      };

      const seeded = await executionConfig.get();
      const seededText = seeded.bindings['text.generate'];
      assert.ok(seededText, 'seed must commit the text.generate binding');
      assert.equal(seeded.bindings['image.generate'], undefined, 'seed must leave image.generate absent');

      // The fixture daemon serves its own live local text model, not the
      // bundled default the seeded local/default alias resolves to. Commit
      // the fixture text binding first — the turn below then proves that a
      // config mutation is what turn admission consumes (K-AGCORE-147).
      const fixtureTextBinding = {
        route: 'local' as const,
        modelId: fixture.route.executionBinding.modelId,
        ...(fixture.route.executionBinding.connectorId
          ? { connectorId: fixture.route.executionBinding.connectorId }
          : {}),
        targetRef: fixture.route.targetRef,
      };
      const textCommitted = await executionConfig.upsert({
        expectedRevision: seeded.revision,
        bindings: {
          'text.generate': fixtureTextBinding,
        },
      });
      assert.equal(textCommitted.revision, seeded.revision + 1);

      // 1. Text turn happy path: the request carries NO execution bindings
      // and resolves against the committed config (the fixture live local
      // text model committed above).
      const textTurn = await runTurn('hello from the execution config cutover');
      assert.equal(textTurn.terminal.type, 'turn-completed', turnDiagnostics(textTurn));
      assert.ok(
        textTurn.terminal.type === 'turn-completed'
        && textTurn.terminal.outputText.includes('Hello from the Runtime Agent live fixture.'),
        `text turn must produce the fixture model reply: ${turnDiagnostics(textTurn)}`,
      );
      assertNoImageArtifacts(textTurn.parts, 'plain text turn');

      // 2. Snapshot evidence: config_revision fixed at admission plus the
      // admission-resolved execution bindings.
      const textSnapshot = await agentClient.getSessionSnapshot({
        ...identity,
        conversationAnchorId: fixture.conversationAnchorId,
      });
      assert.equal(textSnapshot.configRevision, textCommitted.revision, 'snapshot must project the committed config revision fixed at admission');
      const snapshotTextBinding = (textSnapshot.executionBindings ?? {})['text.generate'] as Record<string, unknown> | undefined;
      assert.ok(snapshotTextBinding, 'snapshot must project the admission-resolved text.generate binding');
      assert.equal(snapshotTextBinding.route, 'local');
      assert.ok(
        String(snapshotTextBinding.model_id ?? snapshotTextBinding.modelId ?? ''),
        'snapshot text.generate binding must carry the admission-resolved model id',
      );

      // 3. Legacy request-level execution_bindings are rejected on ingress
      // with InvalidArgument (hand-built payload: the SDK builder can no
      // longer emit the field).
      await assert.rejects(
        sendLegacyExecutionBindingsTurn(fixture, seededText),
        (error: Error) => {
          assert.match(
            String(error.message || ''),
            /execution_bindings are not admitted; runtime agent execution config is authoritative \(K-AGCORE-147\)/,
          );
          return true;
        },
      );

      // 4. Image action with NO committed image binding: the APML branch
      // tells the model image generation is not configured, so the turn must
      // complete without any image artifact. The typed action_failed
      // reason=image_binding_missing branch is covered by the runtime Go
      // tests (public_chat_action_projection_test.go).
      const missingImageTurn = await runTurn('please make an image artifact for me');
      assertNoImageArtifacts(missingImageTurn.parts, 'image turn without committed image binding');

      // 5. Upsert the fixture cloud image binding through the executionConfig
      // module: revision advances by exactly one.
      const imageBinding = {
        route: 'cloud' as const,
        modelId: fixture.imageRoute.executionBinding.modelId,
        ...(fixture.imageRoute.executionBinding.connectorId
          ? { connectorId: fixture.imageRoute.executionBinding.connectorId }
          : {}),
        targetRef: fixture.imageRoute.targetRef,
      };
      const committed = await executionConfig.upsert({
        expectedRevision: textCommitted.revision,
        bindings: {
          'text.generate': fixtureTextBinding,
          'image.generate': imageBinding,
        },
      });
      assert.equal(committed.revision, textCommitted.revision + 1);

      // 6. Image action end-to-end against the committed config: the fixture
      // model plans the action and the runtime materializes a real image
      // artifact (action_planned -> artifact_ready with readable PNG bytes).
      const imageTurn = await runTurn('please make an image artifact now');
      assert.equal(imageTurn.terminal.type, 'turn-completed', turnDiagnostics(imageTurn));
      assert.ok(
        imageTurn.parts.some((part) => part.type === 'beat-planned'),
        `image turn must plan the image action beat: ${turnDiagnostics(imageTurn)}`,
      );
      const artifactReady = imageTurn.parts.find(
        (part): part is Extract<NimiRuntimeAgentTurnRunnerPart, { type: 'artifact-ready' }> =>
          part.type === 'artifact-ready',
      );
      assert.ok(artifactReady, `image turn must project artifact-ready: ${turnDiagnostics(imageTurn)}`);
      assert.equal(artifactReady.mimeType, 'image/png');
      const artifactId = String(artifactReady.artifactId || '');
      assert.ok(artifactId, 'artifact-ready must carry the runtime artifact id');
      const artifactBytes = await withLiveFixtureSession(
        fixture,
        (callOptions) => fixture.runtime.artifacts.readArtifactBytes({ artifactId }, callOptions),
      );
      assert.ok(
        (artifactBytes.bytes?.byteLength ?? 0) > 0,
        'runtime must serve real image artifact bytes for the turn artifact',
      );

      // 7. Config-revision turn semantics (sequential form): the next turn
      // after the upsert resolves against the advanced revision and the
      // session snapshot projects it, including the image binding.
      const imageSnapshot = await agentClient.getSessionSnapshot({
        ...identity,
        conversationAnchorId: fixture.conversationAnchorId,
      });
      assert.equal(imageSnapshot.configRevision, committed.revision, 'post-upsert turn must fix the advanced config revision at admission');
      const snapshotImageBinding = (imageSnapshot.executionBindings ?? {})['image.generate'] as Record<string, unknown> | undefined;
      assert.ok(snapshotImageBinding, 'post-upsert snapshot must project the committed image.generate binding');
      assert.equal(snapshotImageBinding.route, 'cloud');
    },
  });
});

type LiveCutoverFixtureSurface = {
  readonly runtime: Parameters<typeof createFixtureRuntimeAgentClient>[0];
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
};

// Mirrors the fixture scope runner: acquires the scopes and attaches app
// session metadata to the typed call, like every other live fixture call.
async function withLiveFixtureScopes<T>(
  fixture: LiveCutoverFixtureSurface,
  scopes: readonly string[],
  operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: DESKTOP_APP_ID,
    appInstanceId: DESKTOP_APP_INSTANCE_ID,
    deviceId: DESKTOP_DEVICE_ID,
    appVersion: 'sdk-runtime-agent-live-e2e',
    developerRegistration: false,
    auth: fixture.runtime.auth,
  });
  return withNimiRuntimeAgentScopes({
    runtime: {
      appId: DESKTOP_APP_ID,
      auth: fixture.runtime.auth,
      appAuth: fixture.runtime.grants,
    },
    subjectUserId: fixture.ownerUserId,
  }, scopes, async (callOptions) => {
    const appSessionMetadata = await sessionMetadata();
    return operation({
      ...callOptions,
      metadata: {
        ...appSessionMetadata,
        ...(callOptions.metadata ?? {}),
      },
    });
  });
}

// ReadArtifactBytes is not a protected-scope surface on the first-party
// path (scoped-binding consumers attach runtime.artifact.read-bytes through
// the binding relation instead); it only needs app session metadata.
async function withLiveFixtureSession<T>(
  fixture: LiveCutoverFixtureSurface,
  operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: DESKTOP_APP_ID,
    appInstanceId: DESKTOP_APP_INSTANCE_ID,
    deviceId: DESKTOP_DEVICE_ID,
    appVersion: 'sdk-runtime-agent-live-e2e',
    developerRegistration: false,
    auth: fixture.runtime.auth,
  });
  return operation({ metadata: await sessionMetadata() });
}

async function sendLegacyExecutionBindingsTurn(
  fixture: LiveCutoverFixtureSurface,
  textBinding: { readonly route: 'local' | 'cloud'; readonly modelId: string },
): Promise<unknown> {
  const payload = toNimiRuntimeProtoStruct({
    local_agent_ref: fixture.localAgentRef,
    owner_user_id: fixture.ownerUserId,
    runtime_source_ref: fixture.runtimeSourceRef,
    conversation_anchor_id: fixture.conversationAnchorId,
    request_id: `runtime-agent-live-legacy-bindings:${randomUUID()}`,
    messages: [{ role: 'user', content: 'legacy execution bindings must be rejected' }],
    execution_bindings: {
      'text.generate': {
        route: textBinding.route,
        model_id: textBinding.modelId,
      },
    },
  });
  return withLiveFixtureScopes(fixture, ['runtime.agent.turn.write'], (callOptions) =>
    fixture.runtime.appMessages.sendAppMessage({
      fromAppId: DESKTOP_APP_ID,
      toAppId: 'runtime.agent',
      subjectUserId: fixture.ownerUserId,
      messageType: 'runtime.agent.turn.request',
      payload,
      requireAck: false,
    }, {
      ...callOptions,
      metadata: {
        ...(callOptions.metadata ?? {}),
        'x-nimi-idempotency-key': `runtime-agent-live-legacy-bindings:${randomUUID()}`,
        'x-nimi-caller-kind': 'sdk-test-fixture',
        'x-nimi-caller-id': DESKTOP_APP_ID,
      },
    }));
}

function assertNoImageArtifacts(parts: readonly NimiRuntimeAgentTurnRunnerPart[], label: string): void {
  assert.ok(
    !parts.some((part) => part.type === 'artifact-ready'),
    `${label} must not project artifact-ready parts`,
  );
}

function turnDiagnostics(turn: {
  readonly parts: readonly NimiRuntimeAgentTurnRunnerPart[];
  readonly terminal: NimiRuntimeAgentTurnRunnerPart;
}): string {
  return JSON.stringify({
    terminal: turn.terminal,
    parts: turn.parts.map((part) => part.type),
  });
}

// Runs one public chat turn through the canonical SDK turn runner
// (subscription racing and stall recovery are the runner's proven job) and
// collects the runner parts until the terminal part.
async function runFixtureTurnAndCollectEvents(input: {
  readonly agentClient: ReturnType<typeof createFixtureRuntimeAgentClient>;
  readonly identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  };
  readonly conversationAnchorId: string;
  readonly text: string;
  readonly timeoutMs?: number;
}): Promise<{
  readonly requestId: string;
  readonly parts: readonly NimiRuntimeAgentTurnRunnerPart[];
  readonly terminal: NimiRuntimeAgentTurnRunnerPart;
}> {
  const requestId = `runtime-agent-live-cutover-turn:${randomUUID()}`;
  const deadline = Date.now() + (input.timeoutMs ?? 90_000);
  const streamed = await input.agentClient.streamTurn({
    ...input.identity,
    conversationAnchorId: input.conversationAnchorId,
    requestId,
    messages: [{ role: 'user', content: input.text }],
  });
  const iterator = streamed.stream[Symbol.asyncIterator]();
  const parts: NimiRuntimeAgentTurnRunnerPart[] = [];
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`timed out waiting for turn ${requestId}; observed: ${JSON.stringify(parts.map((part) => part.type))}`);
      }
      const next = await nextPartWithTimeout(iterator, remaining, requestId);
      parts.push(next);
      if (next.type === 'turn-completed' || next.type === 'turn-failed' || next.type === 'turn-canceled') {
        return { requestId, parts, terminal: next };
      }
    }
  } finally {
    // Closing the runner stream must never mask the turn outcome.
    void Promise.resolve()
      .then(() => iterator.return?.())
      .catch(() => undefined);
  }
}

async function nextPartWithTimeout(
  iterator: AsyncIterator<NimiRuntimeAgentTurnRunnerPart>,
  timeoutMs: number,
  label: string,
): Promise<NimiRuntimeAgentTurnRunnerPart> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const next = await Promise.race([iterator.next(), timeoutPromise]);
    if (next === 'timeout') {
      throw new Error(`timed out waiting for the next turn runner part (${label})`);
    }
    if (next.done) {
      throw new Error(`turn runner stream ended before the terminal part (${label})`);
    }
    return next.value;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function readinessState(
  snapshot: NimiRuntimeAgentExecutionReadinessSnapshotProjection,
  capability: string,
): string {
  const entry = snapshot.capabilities.find((candidate) => candidate.capability === capability);
  assert.ok(entry, `readiness snapshot must project ${capability}`);
  assert.ok(entry.probedAt, `readiness for ${capability} must carry a probe timestamp`);
  return entry.state;
}

async function nextSnapshot(
  iterator: AsyncIterator<NimiRuntimeAgentExecutionReadinessSnapshotProjection>,
  label: string,
  timeoutMs = 30_000,
): Promise<NimiRuntimeAgentExecutionReadinessSnapshotProjection> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const next = await Promise.race([iterator.next(), timeoutPromise]);
    if (next === 'timeout') {
      throw new Error(`timed out waiting for ${label}`);
    }
    if (next.done) {
      throw new Error(`readiness subscription ended before ${label}`);
    }
    return next.value;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
