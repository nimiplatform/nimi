import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentPresentationBackendKind,
  AgentEventType,
  ExecutionMode,
  LocalAssetKind,
  LocalAssetStatus,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
  SpeechTimingMode,
  VoiceOutputMode,
  VoicePlaybackState,
  VoiceReferenceKind,
} from '../core-generated/runtime-typed-client';
import { createNimiRuntimeEmbeddingClient, toRuntimeDurableTargetRef } from '../core/ai';
import { runNimiRuntimeImageGeneration } from '../features/generation';
import { createNimiRuntimeAppSessionMetadataProvider } from './app-session';
import { withNimiRuntimeAgentScopes } from './runtime-agent-protected';
import { issueNimiRuntimeAgentScopedBinding } from './runtime-agent-scoped-binding';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  SOURCE_MATERIALIZATION_AUDIENCE,
  withRuntimeAgentLiveE2EFixture,
} from './runtime-agent-live-e2e-fixture.test-helper';
import {
  createFixtureRuntimeAgentClient,
  createRuntimeForEndpoint,
} from './runtime-agent-live-e2e-fixture-runtime.test-helper';
import { createNimiRuntimeAgentVoiceModule } from './runtime-agent-voice';
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
      assert.equal((packet.sourceDisplayMetadata as { readonly worldName?: unknown }).worldName, 'Runtime Live World');
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
      assert.equal(
        (metadata.sourceMaterialization as { readonly sourceWorldName?: unknown }).sourceWorldName,
        'Runtime Live World',
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

test('runtime agent live e2e fixture returns SDK-owned native voice route projection and streams speech', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    run: async (fixture) => {
      assert.equal(fixture.voiceRoute.capability, 'audio.synthesize');
      assert.equal(fixture.voiceRoute.selectedTargetRefKind, 'cloud-connector');
      assert.match(fixture.voiceRoute.resolvedBindingRef, /^cloud:audio\.synthesize:/);
      assert.equal(fixture.voiceRoute.executionBinding.route, 'cloud');
      assert.equal(fixture.voiceRoute.executionBinding.modelId, 'qwen3-tts-runtime-live-native-stream');
      assert.ok(fixture.voiceRoute.executionBinding.connectorId, 'voice route must expose connector execution binding');
      assert.match(fixture.voiceAsset.voiceAssetId, /^[0-9A-HJKMNP-TV-Z]{26}$/u);
      assert.equal(fixture.voiceAsset.providerVoiceRef, 'runtime-live-voice');
      assert.equal(fixture.voiceAsset.defaultVoiceReference, `voice_asset_id:${fixture.voiceAsset.voiceAssetId}`);

      const appSessionMetadata = await createNimiRuntimeAppSessionMetadataProvider({
        appId: 'nimi.desktop',
        appInstanceId: 'nimi.desktop.local-first-party',
        deviceId: 'desktop-shell',
        capabilities: ['ai.spend.meter'],
        auth: fixture.runtime.auth,
      })();
      const events = await withNimiRuntimeAgentScopes({
        runtime: {
          appId: 'nimi.desktop',
          auth: fixture.runtime.auth,
          appAuth: fixture.runtime.grants,
        },
        subjectUserId: fixture.ownerUserId,
      }, ['ai.spend.meter'], async (callOptions) => {
        const collected = [];
        for await (const event of fixture.runtime.ai.streamScenario({
          head: {
            appId: 'nimi.desktop',
            subjectUserId: fixture.ownerUserId,
            routePolicy: RoutePolicy.CLOUD,
            modelId: fixture.voiceRoute.executionBinding.modelId,
            fallback: 0,
            timeoutMs: 60_000,
            connectorId: '',
            targetRef: toRuntimeDurableTargetRef(fixture.voiceRoute.targetRef),
          },
          scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
          executionMode: ExecutionMode.STREAM,
          spec: {
            spec: {
              oneofKind: 'speechSynthesize',
              speechSynthesize: {
                text: 'hello from the native voice live fixture',
                language: 'zh',
                audioFormat: 'wav',
                sampleRateHz: 16_000,
                speed: 0,
                pitch: 0,
                volume: 0,
                emotion: '',
                timingMode: SpeechTimingMode.WORD,
                voiceRef: {
                  kind: VoiceReferenceKind.VOICE_ASSET,
                  reference: {
                    oneofKind: 'voiceAssetId',
                    voiceAssetId: fixture.voiceAsset.voiceAssetId,
                  },
                },
              },
            },
          },
          extensions: [],
        }, {
          ...callOptions,
          metadata: {
            ...appSessionMetadata,
            ...(callOptions.metadata ?? {}),
          },
        })) {
          collected.push(event);
        }
        return collected;
      });

      const started = events.find((event) => event.payload.oneofKind === 'started')?.payload;
      assert.equal(started?.oneofKind, 'started');
      assert.equal(started.started.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
      const artifactDeltas = events
        .filter((event) => event.payload.oneofKind === 'delta')
        .map((event) => event.payload.oneofKind === 'delta' ? event.payload.delta.delta : { oneofKind: undefined })
        .filter((delta) => delta.oneofKind === 'artifact');
      assert.equal(artifactDeltas.length > 0, true, 'native voice stream must emit artifact audio deltas');
      assert.equal(artifactDeltas.every((delta) => delta.oneofKind === 'artifact' && delta.artifact.mimeType === 'audio/wav' && delta.artifact.chunk.byteLength > 0), true);
      const completed = events.find((event) => event.payload.oneofKind === 'completed')?.payload;
      assert.equal(completed?.oneofKind, 'completed');
      assert.equal(completed.completed.streamSimulated, false);
      assert.equal(
        fixture.realmRequests.some((request) =>
          request.method === 'POST'
          && request.path === '/v1/audio/speech'
          && request?.body?.stream === true
          && request?.body?.model === fixture.voiceRoute.executionBinding.modelId
          && request?.body?.voice === 'runtime-live-voice'
        ),
        true,
        'voice fixture must resolve Runtime VoiceAsset to provider handle only inside Runtime',
      );
      assert.equal(
        fixture.realmRequests.some((request) =>
          request.method === 'POST'
          && request.path === '/api/v1/services/audio/tts/customization'
          && request?.body?.input?.target_model === fixture.voiceRoute.executionBinding.modelId
        ),
        true,
        'voice fixture must create custom voice through Runtime voice workflow before synthesis',
      );
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

test('runtime agent live e2e fixture exposes native Runtime Agent voice chunks through typed stream', {
  timeout: 180_000,
}, async () => {
  await withRuntimeAgentLiveE2EFixture({
    voiceSpeechStreamDelayMs: 8_000,
    run: async (fixture) => {
      const progress: Record<string, unknown> = { stage: 'start' };
      try {
        const agentClient = createFixtureRuntimeAgentClient(fixture.runtime);
        const identity = {
          ownerUserId: fixture.ownerUserId,
          runtimeSourceRef: fixture.runtimeSourceRef,
          localAgentRef: fixture.localAgentRef,
        };
        progress.stage = 'commit_execution_config';
        const seeded = await agentClient.agentAIConfig.get(identity);
        await agentClient.agentAIConfig.upsert({
          ...identity,
          expectedRevision: seeded.revision,
          intents: {
            ...seeded.intents,
            'text.generate': {
              route: fixture.route.executionBinding.route,
              modelId: fixture.route.executionBinding.modelId,
              targetRef: fixture.route.targetRef,
            },
            'audio.synthesize': {
              route: fixture.voiceRoute.executionBinding.route,
              modelId: fixture.voiceRoute.executionBinding.modelId,
              ...(fixture.voiceRoute.executionBinding.connectorId
                ? { connectorId: fixture.voiceRoute.executionBinding.connectorId }
                : {}),
              targetRef: fixture.voiceRoute.targetRef,
            },
          },
        });
        progress.stage = 'set_presentation_profile';
        await fixture.runtime.agents.setAgentPresentationProfile({
          context: {
            appId: 'nimi.desktop',
            subjectUserId: fixture.ownerUserId,
            ownerUserId: fixture.ownerUserId,
            runtimeSourceRef: fixture.runtimeSourceRef,
            localAgentRef: fixture.localAgentRef,
          },
          agentId: fixture.localAgentRef,
          mutation: {
            oneofKind: 'profile',
            profile: {
              backendKind: AgentPresentationBackendKind.VRM,
              avatarAssetRef: 'runtime-presentation-avatar:sdk-live-voice-stream-fixture',
              expressionProfileRef: 'expression://runtime-live/calm',
              idlePreset: 'idle-soft',
              interactionPolicyRef: 'policy://runtime-live/ambient',
              defaultVoiceReference: fixture.voiceAsset.defaultVoiceReference,
              avatarAutoplay: true,
            },
          },
        }, {
          metadata: {
            idempotencyKey: `sdk-live-runtime-agent-voice-stream-profile:${fixture.localAgentRef}`,
            'x-nimi-idempotency-key': `sdk-live-runtime-agent-voice-stream-profile:${fixture.localAgentRef}`,
          },
        });
        progress.stage = 'subscribe_events_start';
        const eventStream = await withNimiRuntimeAgentScopes({
          runtime: {
            appId: 'nimi.desktop',
            auth: fixture.runtime.auth,
            appAuth: fixture.runtime.grants,
          },
          subjectUserId: fixture.ownerUserId,
        }, ['runtime.agent.read'], async (callOptions) =>
          fixture.runtime.agents.subscribeAgentEvents({
            context: {
              appId: 'nimi.desktop',
              subjectUserId: fixture.ownerUserId,
              ownerUserId: fixture.ownerUserId,
              runtimeSourceRef: fixture.runtimeSourceRef,
              localAgentRef: fixture.localAgentRef,
            },
            agentId: '',
            eventFilters: [AgentEventType.PRESENTATION],
          }, callOptions),
        );
        const eventIterator = eventStream[Symbol.asyncIterator]();
        try {
          progress.stage = 'send_turn_start';
          const response = await fixture.sendTurn('typed native Runtime Agent voice stream fixture');
          assert.equal(response.accepted, true);

          progress.stage = 'waiting_projection_chunk';
          const nativeChunk = await nextLiveNativeVoiceChunk(eventIterator, Date.now() + 60_000);
          const voiceStreamId = String(nativeChunk.voiceStreamId || '').trim();
          progress.stage = 'projection_chunk_received';
          progress.voiceStreamId = voiceStreamId;
          progress.turnId = nativeChunk.turnId || '';
          assert.match(voiceStreamId, /^runtime-agent-voice-stream:/);
          assert.equal(nativeChunk.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
          assert.equal(nativeChunk.voicePlaybackState, VoicePlaybackState.ACTIVE);
          assert.equal(nativeChunk.finalChunk, false);
          assert.equal(nativeChunk.audioArtifactId, '');

          progress.stage = 'typed_module_create';
          const voice = createNimiRuntimeAgentVoiceModule({
            runtime: {
              appId: 'nimi.desktop',
              auth: fixture.runtime.auth,
              appAuth: fixture.runtime.grants,
              agents: fixture.runtime.agents,
              artifacts: fixture.runtime.artifacts,
            },
            getSubjectUserId: () => fixture.ownerUserId,
          });
          progress.stage = 'typed_subscribe_start';
          const typedStream = await promiseWithTimeout(
            voice.subscribeStream({
              ownerUserId: fixture.ownerUserId,
              runtimeSourceRef: fixture.runtimeSourceRef,
              localAgentRef: fixture.localAgentRef,
              conversationAnchorId: fixture.conversationAnchorId,
              turnId: nativeChunk.turnId || '',
              voiceStreamId,
            }),
            20_000,
            () => `typed Runtime Agent voice stream subscribe did not return; progress=${JSON.stringify(progress)}`,
          );
          const typedIterator = typedStream[Symbol.asyncIterator]();
          try {
            progress.stage = 'typed_waiting_first_chunk';
            const first = await nextAsyncIteratorValue(
              typedIterator,
              Date.now() + 20_000,
              () => `typed native Runtime Agent voice stream first chunk timed out; progress=${JSON.stringify(progress)}`,
            );
            progress.stage = 'typed_first_chunk_received';
            assert.equal(first.done, false);
            assert.equal(first.value.voiceStreamId, voiceStreamId);
            assert.equal(first.value.terminal, false);
            assert.equal(first.value.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
            assert.equal((first.value.chunk?.byteLength ?? 0) > 0, true);
          } finally {
            await promiseWithTimeout(
              Promise.resolve(typedIterator.return?.()),
              2_000,
              () => `typed Runtime Agent voice stream iterator cleanup timed out; progress=${JSON.stringify(progress)}`,
            ).catch(() => undefined);
          }

          progress.stage = 'admit_scoped_voice_app';
          const zhiyuAppId = 'nimi.zhiyu';
          const zhiyuRuntime = createRuntimeForEndpoint(fixture.endpoint, zhiyuAppId);
          const zhiyuCaller = await fixture.admitLocalFirstPartyRuntimeAccountCaller({
            appId: zhiyuAppId,
            appInstanceId: `${zhiyuAppId}.local-first-party`,
            deviceId: 'sdk-live-scoped-voice-device',
            capabilities: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
          });
          const zhiyuSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
            appId: zhiyuAppId,
            appInstanceId: `${zhiyuAppId}.local-first-party`,
            deviceId: 'sdk-live-scoped-voice-device',
            capabilities: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
            developerRegistration: false,
            auth: zhiyuRuntime.auth,
          });
          progress.stage = 'issue_scoped_voice_binding';
          const scopedBinding = await issueNimiRuntimeAgentScopedBinding({
            runtime: { account: zhiyuRuntime.account },
            caller: zhiyuCaller,
            agentId: fixture.localAgentRef,
            conversationAnchorId: fixture.conversationAnchorId,
            scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
            ttlSeconds: 900,
            options: withNimiRuntimeIdempotencyMetadata(
              undefined,
              `sdk-live-runtime-agent-voice-stream-scoped-binding:${voiceStreamId}`,
            ),
          });
          progress.stage = 'scoped_typed_module_create';
          const scopedVoice = createNimiRuntimeAgentVoiceModule({
            runtime: {
              appId: zhiyuAppId,
              auth: zhiyuRuntime.auth,
              appAuth: zhiyuRuntime.grants,
              agents: zhiyuRuntime.agents,
              artifacts: zhiyuRuntime.artifacts,
            },
            getSubjectUserId: () => fixture.ownerUserId,
            withScopes: (scopes, operation) =>
              withNimiRuntimeAgentScopes({
                runtime: {
                  appId: zhiyuAppId,
                  auth: zhiyuRuntime.auth,
                  appAuth: zhiyuRuntime.grants,
                },
                subjectUserId: fixture.ownerUserId,
              }, scopes, async (callOptions) => operation({
                ...callOptions,
                metadata: {
                  ...await zhiyuSessionMetadata(),
                  ...(callOptions.metadata ?? {}),
                },
              })),
          });
          progress.stage = 'scoped_typed_subscribe_start';
          const scopedTypedStream = await promiseWithTimeout(
            scopedVoice.subscribeStream({
              ownerUserId: fixture.ownerUserId,
              runtimeSourceRef: fixture.runtimeSourceRef,
              localAgentRef: fixture.localAgentRef,
              conversationAnchorId: fixture.conversationAnchorId,
              turnId: nativeChunk.turnId || '',
              voiceStreamId,
              scopedBinding: scopedBinding.scopedBinding,
            }),
            20_000,
            () => `scoped typed Runtime Agent voice stream subscribe did not return; progress=${JSON.stringify(progress)}`,
          );
          const scopedTypedIterator = scopedTypedStream[Symbol.asyncIterator]();
          try {
            progress.stage = 'scoped_typed_waiting_first_chunk';
            const scopedFirst = await nextAsyncIteratorValue(
              scopedTypedIterator,
              Date.now() + 20_000,
              () => `scoped typed native Runtime Agent voice stream first chunk timed out; progress=${JSON.stringify(progress)}`,
            );
            progress.stage = 'scoped_typed_first_chunk_received';
            assert.equal(scopedFirst.done, false);
            assert.equal(scopedFirst.value.voiceStreamId, voiceStreamId);
            assert.equal(scopedFirst.value.terminal, false);
            assert.equal(scopedFirst.value.voiceOutputMode, VoiceOutputMode.NATIVE_STREAM);
            assert.equal((scopedFirst.value.chunk?.byteLength ?? 0) > 0, true);
          } finally {
            await promiseWithTimeout(
              Promise.resolve(scopedTypedIterator.return?.()),
              2_000,
              () => `scoped typed Runtime Agent voice stream iterator cleanup timed out; progress=${JSON.stringify(progress)}`,
            ).catch(() => undefined);
          }
        } finally {
          await promiseWithTimeout(
            Promise.resolve(eventIterator.return?.()),
            2_000,
            () => `Runtime Agent event stream cleanup timed out; progress=${JSON.stringify(progress)}`,
          ).catch(() => undefined);
        }
      } catch (error) {
        throw new Error(`typed Runtime Agent voice stream fixture failed; progress=${JSON.stringify(progress)}`, {
          cause: error,
        });
      }
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

async function nextLiveNativeVoiceChunk(
  iterator: AsyncIterator<any>,
  deadlineMs: number,
) {
  for (;;) {
    const next = await nextAsyncIteratorValue(iterator, deadlineMs, 'native Runtime Agent voice chunk event');
    assert.equal(next.done, false, 'Runtime Agent event stream ended before native voice chunk');
    const event = next.value;
    const presentation = event?.detail?.oneofKind === 'presentation'
      ? event.detail.presentation
      : null;
    if (
      presentation?.voiceOutputMode === VoiceOutputMode.NATIVE_STREAM
      && presentation.voiceStreamId
      && presentation.finalChunk === false
    ) {
      return presentation;
    }
  }
}

async function nextAsyncIteratorValue<T>(
  iterator: AsyncIterator<T>,
  deadlineMs: number,
  label: string | (() => string),
): Promise<IteratorResult<T>> {
  const remainingMs = Math.max(1, deadlineMs - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          const message = typeof label === 'function' ? label() : `${label} timed out after ${remainingMs}ms`;
          reject(new Error(message));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string | (() => string),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(typeof label === 'function' ? label() : label));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
