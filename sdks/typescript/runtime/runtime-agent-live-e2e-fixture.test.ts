import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalAssetKind,
  LocalAssetStatus,
  ScenarioJobStatus,
} from '../core-generated/runtime-typed-client';
import { createNimiRuntimeEmbeddingClient, toRuntimeDurableTargetRef } from '../core/ai';
import { runNimiRuntimeImageGeneration } from '../features/generation';
import { createNimiRuntimeAppSessionMetadataProvider } from './app-session';
import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';
import {
  SOURCE_MATERIALIZATION_AUDIENCE,
  withRuntimeAgentLiveE2EFixture,
} from './runtime-agent-live-e2e-fixture.test-helper';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';

test('runtime agent live e2e fixture mints source packet through Runtime-mediated Realm', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.match(fixture.endpoint, /^127\.0\.0\.1:\d+$/);
      assert.equal(fixture.sourceRef.kind, 'worldCharacter');
      assert.ok(fixture.sourceRef.sourceContentHash);

      const packet = await fixture.createSourceMaterializationPacket();

      assert.equal(packet.packetSchemaVersion, 'realm.source-materialization-packet/v1');
      assert.equal(packet.intendedRuntimeAudience, SOURCE_MATERIALIZATION_AUDIENCE);
      assert.equal(packet.runtimeSourceRef, fixture.runtimeSourceRef);
      assert.equal(packet.sourceKind, fixture.sourceRef.kind);
      assert.equal(packet.sourceId, fixture.sourceRef.sourceId);
      assert.equal(packet.sourceWorldId, fixture.sourceRef.worldId);
      assert.equal(packet.sourceContentHash, fixture.sourceRef.sourceContentHash);
      assert.match(packet.packetHash, /^[a-f0-9]{64}$/);
      assert.match(packet.packetProof, /^hmac-sha256:[a-f0-9]{64}$/);

      assert.ok(
        fixture.realmRequests.some((request) =>
          request.method === 'POST'
          && request.path === '/api/realm/core/source-materialization-packets'
          && request.authorization === 'Bearer runtime-live-access-token'
        ),
        'packet minting must travel through Runtime account Realm mediation',
      );
    },
  });
});

test('runtime agent live e2e fixture seeds Runtime-owned LocalAgent from source packet', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.equal(fixture.ownerUserId, 'user-runtime-agent-live');
      assert.match(fixture.runtimeSourceRef, /^runtime-source:/);
      assert.match(fixture.localAgentRef, /^local-agent:/);
      assert.notEqual(fixture.localAgentRef, fixture.runtimeSourceRef);
      assert.equal(fixture.localAgent.ownerUserId, fixture.ownerUserId);
      assert.equal(fixture.localAgent.runtimeSourceRef, fixture.runtimeSourceRef);
      assert.equal(fixture.localAgent.localAgentRef, fixture.localAgentRef);

      const metadata = fromNimiRuntimeProtoStruct(fixture.localAgent.agent.metadata);
      assert.equal(metadata.sourceMaterializationPacket, undefined);
      assert.equal(
        (metadata.sourceMaterialization as { readonly runtimeSourceRef?: unknown }).runtimeSourceRef,
        fixture.runtimeSourceRef,
      );
    },
  });
});

test('runtime agent live e2e fixture opens Runtime-owned conversation anchor', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.match(fixture.conversationAnchorId, /^agent_anchor_/);
      assert.equal(fixture.conversation.anchor?.conversationAnchorId, fixture.conversationAnchorId);
      assert.equal(fixture.conversation.anchor?.localAgentRef, fixture.localAgentRef);
      assert.equal(fixture.conversation.anchor?.ownerUserId, fixture.ownerUserId);
      assert.equal(fixture.conversation.anchor?.runtimeSourceRef, fixture.runtimeSourceRef);
    },
  });
});

test('runtime agent live e2e fixture returns SDK-owned text route projection', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.equal(fixture.route.capability, 'text.generate');
      assert.equal(fixture.route.selectedTargetRefKind, 'local-runtime');
      assert.match(fixture.route.resolvedBindingRef, /^local:text\.generate:/);
      assert.deepEqual(fixture.route.executionBinding, {
        route: 'local',
        modelId: 'local/runtime-agent-live-e2e',
      });
    },
  });
});

test('runtime agent live e2e fixture returns SDK-owned embedding route projection and executes embedding', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.equal(fixture.embeddingRoute.capability, 'text.embed');
      assert.equal(fixture.embeddingRoute.selectedTargetRefKind, 'local-runtime');
      assert.match(fixture.embeddingRoute.resolvedBindingRef, /^local:text\.embed:/);
      assert.deepEqual(fixture.embeddingRoute.executionBinding, {
        route: 'local',
        modelId: 'local/runtime-agent-live-e2e-embedding',
      });

      const localAssets = await fixture.runtime.local.listLocalAssets({
        statusFilter: LocalAssetStatus.ACTIVE,
        kindFilter: LocalAssetKind.EMBEDDING,
        engineFilter: 'llama',
        pageSize: 20,
        pageToken: '',
      });
      assert.ok(
        localAssets.assets.some((asset) =>
          asset.assetId === 'local/runtime-agent-live-e2e-embedding'
          && asset.status === LocalAssetStatus.ACTIVE
          && asset.kind === LocalAssetKind.EMBEDDING
        ),
        'Runtime must expose the live fixture local embedding route as an active local asset',
      );

      const appSessionMetadata = await createNimiRuntimeAppSessionMetadataProvider({
        appId: 'nimi.desktop',
        appInstanceId: 'nimi.desktop.local-first-party',
        deviceId: 'desktop-shell',
        capabilities: ['ai.spend.meter'],
        auth: fixture.runtime.auth,
      })();
      const result = await withNimiRuntimeAgentScopes({
        runtime: {
          appId: 'nimi.desktop',
          auth: fixture.runtime.auth,
          appAuth: fixture.runtime.grants,
        },
        subjectUserId: fixture.ownerUserId,
      }, ['ai.spend.meter'], async (callOptions) => {
        const embedding = createNimiRuntimeEmbeddingClient({
          runtime: fixture.runtime,
          appId: 'nimi.desktop',
          model: {
            modelId: fixture.embeddingRoute.executionBinding.modelId,
          },
          routePolicy: fixture.embeddingRoute.executionBinding.route,
          subjectUserId: fixture.ownerUserId,
          targetRef: fixture.embeddingRoute.targetRef,
          metadata: {
            ...appSessionMetadata,
            ...(callOptions.metadata ?? {}),
          },
        });
        return embedding.embedText({
          values: ['hello from the live fixture embedding route'],
        });
      });
      assert.equal(result.embeddings.length, 1);
      assert.equal(result.embeddings[0]?.length, 4);
    },
  });
});

test('runtime agent live e2e fixture returns SDK-owned image route projection and executes image generation', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.equal(fixture.imageRoute.capability, 'image.generate');
      assert.equal(fixture.imageRoute.selectedTargetRefKind, 'cloud-connector');
      assert.match(fixture.imageRoute.resolvedBindingRef, /^cloud:image\.generate:/);
      assert.equal(fixture.imageRoute.executionBinding.route, 'cloud');
      assert.equal(fixture.imageRoute.executionBinding.modelId, 'gpt-image-1.5');
      assert.ok(fixture.imageRoute.executionBinding.connectorId, 'image route must expose connector execution binding');

      const appSessionMetadata = await createNimiRuntimeAppSessionMetadataProvider({
        appId: 'nimi.desktop',
        appInstanceId: 'nimi.desktop.local-first-party',
        deviceId: 'desktop-shell',
        capabilities: ['ai.spend.meter'],
        auth: fixture.runtime.auth,
      })();
      const result = await withNimiRuntimeAgentScopes({
        runtime: {
          appId: 'nimi.desktop',
          auth: fixture.runtime.auth,
          appAuth: fixture.runtime.grants,
        },
        subjectUserId: fixture.ownerUserId,
      }, ['ai.spend.meter'], async (callOptions) => {
        try {
          return await runNimiRuntimeImageGeneration({
            runtime: { ai: fixture.runtime.ai },
            head: {
              appId: 'nimi.desktop',
              subjectUserId: fixture.ownerUserId,
              routePolicy: fixture.imageRoute.executionBinding.route,
              modelId: fixture.imageRoute.executionBinding.modelId,
              targetRef: toRuntimeDurableTargetRef(fixture.imageRoute.targetRef),
              timeoutMs: 60_000,
            },
            prompt: 'Runtime live fixture one pixel image',
            size: '1024x1024',
            responseFormat: 'b64_json',
            requestId: 'runtime-agent-live-e2e-image',
            idempotencyKey: 'runtime-agent-live-e2e-image',
            callOptions: {
              ...callOptions,
              metadata: {
                ...appSessionMetadata,
                ...(callOptions.metadata ?? {}),
              },
            },
          });
        } catch (error) {
          throw new Error(`Runtime live fixture image generation failed: ${JSON.stringify({
            imageRoute: fixture.imageRoute,
            error: errorDiagnostics(error),
          })}`);
        }
      });
      assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
      assert.equal(result.artifacts.length, 1);
      assert.equal(result.artifacts[0]?.mimeType, 'image/png');
      assert.ok((result.artifacts[0]?.bytes?.byteLength ?? 0) > 0);
    },
  });
});

test('runtime agent live e2e fixture submits accepted Runtime Agent turn', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      const localAssets = await fixture.runtime.local.listLocalAssets({
        statusFilter: LocalAssetStatus.ACTIVE,
        kindFilter: LocalAssetKind.CHAT,
        engineFilter: 'llama',
        pageSize: 20,
        pageToken: '',
      });
      assert.ok(
        localAssets.assets.some((asset) =>
          asset.assetId === 'local/runtime-agent-live-e2e'
          && asset.status === LocalAssetStatus.ACTIVE
          && asset.kind === LocalAssetKind.CHAT
        ),
        'Runtime must expose the live fixture local chat route as an active local asset',
      );

      const response = await fixture.sendTurn('hello from the live fixture');
      assert.equal(response.accepted, true);
      assert.match(response.messageId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    },
  });
});

function errorDiagnostics(error: unknown): Record<string, unknown> {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  return {
    name: error instanceof Error ? error.name : '',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    code: record.code,
    reasonCode: record.reasonCode,
    actionHint: record.actionHint,
    source: record.source,
    cause: error instanceof Error && error.cause ? errorDiagnostics(error.cause) : undefined,
  };
}
