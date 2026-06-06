import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

import {
  ExecutionMode,
  FallbackPolicy,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
  VoiceReferenceKind,
  type ScenarioArtifact,
  type ScenarioSpec,
} from '../../sdks/typescript/runtime/generated';
import { Runtime } from '../../sdks/typescript/runtime/index';
import { withNimiRuntimeIdempotencyMetadata } from '../../sdks/typescript/runtime/scenario-jobs';
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
} from '../../sdks/typescript/core/ai';
import {
  createNimiImageGenerationScenario,
  createNimiRuntimeGenerationClient,
  createNimiSpeechSynthesisScenario,
  createNimiSpeechTranscriptionScenario,
} from '../../sdks/typescript/features/generation';
import {
  loadGoldFixture,
  loadGoldFixtureAudioInput,
} from './fixtures.mjs';

type GoldFixture = ReturnType<typeof loadGoldFixture>;

const APP_ID = 'nimi.gold-path';
const DEFAULT_SUBJECT_USER_ID = 'user-gold-path-sdk-vnext';
const DEFAULT_TIMEOUT_MS = 300_000;

function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function requireArg(flag: string): string {
  const value = readArg(flag);
  if (!value) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function subjectUserId(): string {
  return String(process.env.NIMI_LIVE_GOLD_SUBJECT_USER_ID || DEFAULT_SUBJECT_USER_ID).trim();
}

function normalizeCloudModelId(modelId: string): string {
  const normalized = String(modelId || '').trim();
  if (!normalized || normalized.toLowerCase().startsWith('cloud/') || normalized.includes('/')) {
    return normalized;
  }
  return `cloud/${normalized}`;
}

function routedModelId(provider: string, modelId: string): string {
  return provider === 'local' ? String(modelId || '').trim() : normalizeCloudModelId(modelId);
}

function sdkRoutePolicy(provider: string): 'local' | 'cloud' {
  return provider === 'local' ? 'local' : 'cloud';
}

function runtimeRoutePolicy(provider: string): RoutePolicy {
  return provider === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD;
}

function createRuntimeModule(endpoint: string): Runtime {
  const accessTokenId = String(process.env.NIMI_LIVE_GOLD_ACCESS_TOKEN_ID || '').trim();
  const accessTokenSecret = String(process.env.NIMI_LIVE_GOLD_ACCESS_TOKEN_SECRET || '').trim();
  return new Runtime({
    appId: APP_ID,
    authMetadata: async () => ({
      ...(accessTokenId ? { 'x-nimi-access-token-id': accessTokenId } : {}),
      ...(accessTokenSecret ? { 'x-nimi-access-token-secret': accessTokenSecret } : {}),
    }),
    transport: {
      type: 'node-grpc',
      endpoint,
    },
  });
}

function scenarioHead(provider: string, modelId: string) {
  return {
    appId: APP_ID,
    subjectUserId: subjectUserId(),
    modelId: routedModelId(provider, modelId),
    routePolicy: runtimeRoutePolicy(provider),
    fallback: FallbackPolicy.DENY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    connectorId: '',
  };
}

function providerModelRef(fixture: GoldFixture) {
  return {
    providerId: fixture.provider,
    modelId: routedModelId(fixture.provider, fixture.model_id),
  };
}

function voiceRefFromFixture(fixture: GoldFixture) {
  const voiceRef = fixture.voice_ref;
  const kind = String(voiceRef?.kind || '').trim();
  const id = String(voiceRef?.id || '').trim();
  if (!kind || !id) {
    return undefined;
  }
  if (kind === 'preset_voice_id') {
    return {
      kind: VoiceReferenceKind.PRESET,
      reference: {
        oneofKind: 'presetVoiceId' as const,
        presetVoiceId: id,
      },
    };
  }
  if (kind === 'provider_voice_ref') {
    return {
      kind: VoiceReferenceKind.PROVIDER_VOICE_REF,
      reference: {
        oneofKind: 'providerVoiceRef' as const,
        providerVoiceRef: id,
      },
    };
  }
  if (kind === 'voice_asset_id') {
    return {
      kind: VoiceReferenceKind.VOICE_ASSET,
      reference: {
        oneofKind: 'voiceAssetId' as const,
        voiceAssetId: id,
      },
    };
  }
  throw new Error(`unsupported voice_ref.kind ${kind}`);
}

function audioInputFromFixture(fixture: GoldFixture) {
  const audio = loadGoldFixtureAudioInput(fixture);
  if (!audio) {
    return null;
  }
  if (audio.kind === 'url') {
    return {
      audio: {
        type: 'url' as const,
        url: audio.url,
      },
      mimeType: audio.mimeType || 'audio/wav',
      referenceAudioUri: audio.url,
      referenceAudioBytes: new Uint8Array(),
    };
  }
  return {
    audio: {
      type: 'bytes' as const,
      bytes: audio.bytes,
    },
    mimeType: audio.mimeType || 'audio/wav',
    referenceAudioUri: '',
    referenceAudioBytes: audio.bytes,
  };
}

function artifactSummary(artifacts: readonly ScenarioArtifact[] | readonly { readonly uri?: string; readonly bytes?: Uint8Array; readonly mimeType?: string }[]) {
  let byteArtifactCount = 0;
  let uriArtifactCount = 0;
  const mimeTypes = new Set<string>();
  for (const artifact of artifacts) {
    const bytes = artifact.bytes;
    if (bytes && bytes.length > 0) {
      byteArtifactCount += 1;
    }
    if (String(artifact.uri || '').trim()) {
      uriArtifactCount += 1;
    }
    const mimeType = String(artifact.mimeType || '').trim();
    if (mimeType) {
      mimeTypes.add(mimeType);
    }
  }
  return {
    artifactCount: artifacts.length,
    byteArtifactCount,
    uriArtifactCount,
    mimeTypes: [...mimeTypes].sort(),
  };
}

async function waitForGenerationJob(generation: ReturnType<typeof createNimiRuntimeGenerationClient>, jobId: string) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let current = await generation.get(jobId);
  while (current.status !== 'completed') {
    if (current.status === 'failed' || current.status === 'cancelled' || current.status === 'timeout') {
      throw new Error(`scenario job ${jobId} ended with ${current.status}: ${current.error || ''}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`scenario job timeout waiting terminal status: ${jobId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    current = await generation.get(jobId);
  }
  return current;
}

async function waitForRuntimeJobDone(runtime: Runtime, jobId: string) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  for (;;) {
    const response = await runtime.ai.getScenarioJob({ jobId });
    const job = response.job;
    const status = job?.status ?? ScenarioJobStatus.UNSPECIFIED;
    if (status === ScenarioJobStatus.COMPLETED) {
      return job;
    }
    if (
      status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      throw new Error(`scenario job ${jobId} ended with ${ScenarioJobStatus[status]}: ${job?.reasonDetail || job?.reasonCode || ''}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`scenario job timeout waiting terminal status: ${jobId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function runTextGenerate(runtime: Runtime, fixture: GoldFixture) {
  const model = createNimiRuntimeAIModel({
    runtime,
    model: providerModelRef(fixture),
    appId: APP_ID,
    subjectUserId: subjectUserId(),
    routePolicy: sdkRoutePolicy(fixture.provider),
    connectorId: '',
    timeoutMs: 60_000,
  });
  const result = await model.generateText({
    model: model.model,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: String(fixture.request.prompt || '').trim() }],
    }],
    system: String(fixture.request.system_prompt || '').trim() || undefined,
  });
  assert.ok(result.text.trim().length > 0, 'text.generate output should not be empty');
  return {
    textLength: result.text.trim().length,
    textPreview: result.text.trim().slice(0, 120),
  };
}

async function runTextEmbed(runtime: Runtime, fixture: GoldFixture) {
  const embedding = createNimiRuntimeEmbeddingClient({
    runtime,
    model: providerModelRef(fixture),
    appId: APP_ID,
    subjectUserId: subjectUserId(),
    routePolicy: sdkRoutePolicy(fixture.provider),
    connectorId: '',
    timeoutMs: 60_000,
  });
  const result = await embedding.embedText({ values: fixture.request.inputs });
  assert.ok(result.embeddings.length > 0, 'text.embed output should not be empty');
  return {
    vectorCount: result.embeddings.length,
    vectorDimensions: result.embeddings.map((embeddingVector: readonly number[]) => embeddingVector.length),
  };
}

async function runMediaScenario(runtime: Runtime, fixture: GoldFixture) {
  const generation = createNimiRuntimeGenerationClient({
    runtime,
    head: {
      appId: APP_ID,
      subjectUserId: subjectUserId(),
      modelId: routedModelId(fixture.provider, fixture.model_id),
      routePolicy: sdkRoutePolicy(fixture.provider),
      connectorId: '',
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  });
  const capability = String(fixture.capability || '').trim();
  let scenario;
  if (capability === 'image.generate') {
    scenario = createNimiImageGenerationScenario({
      kind: 'image',
      prompt: String(fixture.request.prompt || '').trim(),
      negativePrompt: String(fixture.request.negative_prompt || '').trim() || undefined,
    });
  } else if (capability === 'audio.synthesize') {
    scenario = createNimiSpeechSynthesisScenario({
      kind: 'speech-synthesize',
      text: String(fixture.request.text || '').trim(),
      voiceRef: voiceRefFromFixture(fixture),
      language: String(fixture.request.language || '').trim() || undefined,
      audioFormat: String(fixture.request.audio_format || '').trim() || undefined,
    });
  } else if (capability === 'audio.transcribe') {
    const audioInput = audioInputFromFixture(fixture);
    if (!audioInput) {
      throw new Error('audio.transcribe requires audio input');
    }
    scenario = createNimiSpeechTranscriptionScenario({
      kind: 'speech-transcribe',
      audio: audioInput.audio,
      mimeType: audioInput.mimeType,
      language: String(fixture.request.language || '').trim() || undefined,
    });
  } else {
    throw new Error(`unsupported media capability ${capability}`);
  }

  const submitted = await generation.submit({
    scenario,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
  });
  assert.ok(submitted.id, `${capability} job id should not be empty`);
  const job = await waitForGenerationJob(generation, submitted.id);
  const artifacts = await generation.artifacts(submitted.id);
  if (capability !== 'audio.transcribe') {
    assert.ok(artifacts.length > 0, `${capability} should produce artifacts`);
  }
  return {
    jobId: submitted.id,
    traceId: job.runtime?.traceId || '',
    providerJobId: job.runtime?.providerJobId || '',
    ...artifactSummary(artifacts),
  };
}

async function submitVoiceWorkflow(runtime: Runtime, fixture: GoldFixture, scenarioType: ScenarioType, spec: ScenarioSpec) {
  const idempotencyKey = randomUUID();
  return runtime.ai.submitScenarioJob({
    head: scenarioHead(fixture.provider, fixture.model_id),
    scenarioType,
    executionMode: ExecutionMode.ASYNC_JOB,
    spec,
    requestId: randomUUID(),
    idempotencyKey,
    labels: {},
    extensions: [],
  }, withNimiRuntimeIdempotencyMetadata(undefined, idempotencyKey));
}

async function runVoiceWorkflow(runtime: Runtime, fixture: GoldFixture) {
  const capability = String(fixture.capability || '').trim();
  const targetModelId = String(fixture.target_model_id || '').trim();
  if (!targetModelId) {
    throw new Error(`${capability} requires target_model_id`);
  }
  const spec: ScenarioSpec = capability === 'voice_workflow.voice_clone'
    ? {
      spec: {
        oneofKind: 'voiceClone',
        voiceClone: {
          targetModelId,
          input: (() => {
            const audioInput = audioInputFromFixture(fixture);
            if (!audioInput) {
              throw new Error('voice clone requires reference audio');
            }
            return {
              referenceAudioBytes: audioInput.referenceAudioBytes,
              referenceAudioUri: audioInput.referenceAudioUri,
              referenceAudioMime: audioInput.mimeType,
              languageHints: [],
              preferredName: '',
              text: String(fixture.request.text || '').trim() || 'Hello from Nimi SDK vNext gold path voice clone.',
            };
          })(),
        },
      },
    }
    : {
      spec: {
        oneofKind: 'voiceDesign',
        voiceDesign: {
          targetModelId,
          input: {
            instructionText: String(fixture.request.instruction_text || '').trim(),
            previewText: String(fixture.request.preview_text || fixture.request.text || '').trim() || 'Hello from Nimi SDK vNext gold path voice design.',
            language: String(fixture.request.language || '').trim(),
            preferredName: '',
          },
        },
      },
    };

  const response = await submitVoiceWorkflow(
    runtime,
    fixture,
    capability === 'voice_workflow.voice_clone' ? ScenarioType.VOICE_CLONE : ScenarioType.VOICE_DESIGN,
    spec,
  );
  const jobId = String(response.job?.jobId || '').trim();
  assert.ok(jobId, `${capability} job id should not be empty`);
  const job = await waitForRuntimeJobDone(runtime, jobId);
  const artifactResponse = await runtime.ai.getScenarioArtifacts({ jobId });
  const voiceAssetId = String(response.asset?.voiceAssetId || '').trim();
  if (!voiceAssetId) {
    throw new Error(`${capability} did not return voiceAssetId`);
  }
  const deleted = await runtime.ai.deleteVoiceAsset(
    { voiceAssetId },
    withNimiRuntimeIdempotencyMetadata(undefined, `delete-voice:${voiceAssetId}:${randomUUID()}`),
  );
  assert.equal(deleted.ack?.ok, true, `deleteVoiceAsset should acknowledge cleanup for ${voiceAssetId}`);
  return {
    jobId,
    traceId: String(job?.traceId || '').trim(),
    providerJobId: String(job?.providerJobId || '').trim(),
    voiceAssetId,
    ...artifactSummary(artifactResponse.artifacts),
  };
}

async function runFixture(endpoint: string, fixture: GoldFixture) {
  const runtime = createRuntimeModule(endpoint);
  switch (String(fixture.capability || '').trim()) {
    case 'text.generate':
      return runTextGenerate(runtime, fixture);
    case 'text.embed':
      return runTextEmbed(runtime, fixture);
    case 'image.generate':
    case 'audio.synthesize':
    case 'audio.transcribe':
      return runMediaScenario(runtime, fixture);
    case 'voice_workflow.voice_clone':
    case 'voice_workflow.voice_design':
      return runVoiceWorkflow(runtime, fixture);
    case 'video.generate':
      return {
        reserved: true,
      };
    default:
      throw new Error(`unsupported capability ${fixture.capability}`);
  }
}

async function main() {
  const endpoint = requireArg('--endpoint');
  const fixturePath = requireArg('--fixture');
  const fixture = loadGoldFixture(fixturePath);
  if (!fixture.gated) {
    process.stdout.write(`${JSON.stringify({
      status: 'skipped',
      error: 'fixture reserved for architecture only',
    })}\n`);
    return;
  }
  const summary = await runFixture(endpoint, fixture);
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    traceId: String(summary?.traceId || '').trim() || undefined,
    jobId: String(summary?.jobId || '').trim() || undefined,
    artifactSummary: summary,
    bridgeLayer: 'sdk-vnext',
  })}\n`);
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stdout.write(`${JSON.stringify({
    status: 'failed',
    error: detail,
    bridgeLayer: 'sdk-vnext',
  })}\n`);
});
