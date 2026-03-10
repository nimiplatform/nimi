import type { Runtime } from '@nimiplatform/sdk';
import { ExecutionMode, ScenarioJobStatus, ScenarioType } from '@nimiplatform/sdk/runtime';
import {
  asRuntimeInvokeError,
  buildRuntimeCallOptions,
  buildRuntimeRequestMetadata,
  ensureRuntimeLocalModelWarm,
  extractEmbeddings,
  extractRuntimeReasonCode,
  extractTextFromGenerateOutput,
  resolveSourceAndModel,
} from './runtime-ai-bridge.js';

const DESKTOP_REPLAY_MOD_ID = 'core.desktop.ai-gold-path';

export type DesktopReplayFixture = {
  fixture_id: string;
  capability: string;
  provider: string;
  model_id: string;
  target_model_id?: string;
  voice_ref?: {
    kind?: string;
    id?: string;
  };
  request: {
    prompt?: string;
    system_prompt?: string;
    inputs?: string[];
    negative_prompt?: string;
    text?: string;
    language?: string;
    audio_format?: string;
    audio_uri?: string;
    audio_base64?: string;
    mime_type?: string;
    instruction_text?: string;
  };
  request_digest: string;
};

export type DesktopReplayResult = {
  fixtureId: string;
  capability: string;
  layer: 'L3_DESKTOP_REPLAY';
  bridgeLayer: 'desktop.runtime-bridge';
  status: 'passed' | 'failed';
  traceId?: string;
  requestDigest: string;
  resolvedProvider: string;
  resolvedModel: string;
  resolvedTargetModel?: string;
  routePolicy: 'local' | 'cloud';
  fallbackPolicy: 'deny';
  jobId?: string;
  artifactSummary?: Record<string, unknown>;
  reasonCode?: string;
  actionHint?: string;
  error?: string;
};

type DesktopReplayInput = {
  runtime: Runtime;
  fixture: DesktopReplayFixture;
};

function trimPreview(value: string): string {
  const normalized = String(value || '').trim();
  if (normalized.length <= 120) {
    return normalized;
  }
  return normalized.slice(0, 120);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Uint8Array();
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'));
  }
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  }
  throw new Error('DESKTOP_REPLAY_BASE64_UNAVAILABLE');
}

function summarizeArtifacts(artifacts: Array<{ artifactId?: string; mimeType?: string; bytes?: Uint8Array }> | undefined): Record<string, unknown> {
  const safeArtifacts = Array.isArray(artifacts) ? artifacts : [];
  let totalBytes = 0;
  const artifactIds: string[] = [];
  const mimeTypes: string[] = [];
  for (const artifact of safeArtifacts) {
    artifactIds.push(String(artifact?.artifactId || '').trim());
    mimeTypes.push(String(artifact?.mimeType || '').trim());
    totalBytes += artifact?.bytes instanceof Uint8Array ? artifact.bytes.length : 0;
  }
  return {
    artifactCount: safeArtifacts.length,
    artifactIds: artifactIds.filter(Boolean),
    mimeTypes: mimeTypes.filter(Boolean),
    totalBytes,
  };
}

function withFailure(base: Omit<DesktopReplayResult, 'status'>, error: unknown): DesktopReplayResult {
  const normalized = asRuntimeInvokeError(error);
  return {
    ...base,
    status: 'failed',
    traceId: normalized.traceId || undefined,
    reasonCode: extractRuntimeReasonCode(normalized) || normalized.reasonCode || undefined,
    actionHint: normalized.actionHint || undefined,
    error: normalized.message,
  };
}

async function submitAndCollect(runtime: Runtime, request: Record<string, unknown>, metadata: {
  traceId: string;
  callerKind: 'desktop-core' | 'desktop-mod';
  callerId: string;
  surfaceId: string;
  keySource?: 'managed';
}): Promise<{
  traceId: string;
  jobId: string;
  modelResolved: string;
  summary: Record<string, unknown>;
  voiceAssetId?: string;
}> {
  const submitResponse = await runtime.ai.submitScenarioJob(request as never, {
    timeoutMs: 180_000,
    metadata,
  });
  const jobId = String(submitResponse.job?.jobId || '').trim();
  if (!jobId) {
    throw new Error('DESKTOP_REPLAY_JOB_ID_REQUIRED');
  }

  let traceId = String(submitResponse.job?.traceId || metadata.traceId || '').trim();
  let modelResolved = String(submitResponse.job?.modelResolved || '').trim();
  const voiceAssetId = String(submitResponse.asset?.voiceAssetId || '').trim() || undefined;

  const deadline = Date.now() + 180_000;
  for (;;) {
    const jobResponse = await runtime.ai.getScenarioJob({ jobId });
    const status = Number(jobResponse.job?.status || 0);
    if (traceId.length === 0) {
      traceId = String(jobResponse.job?.traceId || '').trim();
    }
    if (modelResolved.length === 0) {
      modelResolved = String(jobResponse.job?.modelResolved || '').trim();
    }
    if (status === ScenarioJobStatus.COMPLETED) {
      const artifactsResponse = await runtime.ai.getScenarioArtifacts({ jobId });
      if (traceId.length === 0) {
        traceId = String(artifactsResponse.traceId || '').trim();
      }
      return {
        traceId,
        jobId,
        modelResolved,
        summary: summarizeArtifacts(artifactsResponse.artifacts as never),
        voiceAssetId,
      };
    }
    if (
      status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      throw new Error(String(jobResponse.job?.reasonDetail || jobResponse.job?.reasonCode || 'DESKTOP_REPLAY_JOB_FAILED'));
    }
    if (Date.now() >= deadline) {
      throw new Error(`DESKTOP_REPLAY_JOB_TIMEOUT:${jobId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function runDesktopBridgeReplay(input: DesktopReplayInput): Promise<DesktopReplayResult> {
  const resolved = resolveSourceAndModel({
    provider: input.fixture.provider,
    model: input.fixture.model_id,
  });
  const base: Omit<DesktopReplayResult, 'status'> = {
    fixtureId: input.fixture.fixture_id,
    capability: input.fixture.capability,
    layer: 'L3_DESKTOP_REPLAY',
    bridgeLayer: 'desktop.runtime-bridge',
    requestDigest: input.fixture.request_digest,
    resolvedProvider: resolved.provider,
    resolvedModel: input.fixture.model_id,
    resolvedTargetModel: input.fixture.target_model_id || undefined,
    routePolicy: resolved.source,
    fallbackPolicy: 'deny',
  };

  try {
    if (input.fixture.capability === 'text.generate') {
      await ensureRuntimeLocalModelWarm({
        modId: DESKTOP_REPLAY_MOD_ID,
        source: resolved.source,
        modelId: resolved.modelId,
        engine: resolved.provider,
        timeoutMs: 120_000,
      });
      const callOptions = await buildRuntimeCallOptions({
        modId: DESKTOP_REPLAY_MOD_ID,
        timeoutMs: 120_000,
        source: resolved.source,
      });
      const response = await input.runtime.ai.executeScenario({
        head: {
          appId: input.runtime.appId,
          modelId: resolved.modelId,
          routePolicy: resolved.routePolicy,
          fallback: resolved.fallbackPolicy,
          timeoutMs: 120_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.TEXT_GENERATE,
        executionMode: ExecutionMode.SYNC,
        spec: {
          spec: {
            oneofKind: 'textGenerate',
            textGenerate: {
              input: [{
                role: 'user',
                content: String(input.fixture.request.prompt || '').trim(),
                name: '',
              }],
              systemPrompt: String(input.fixture.request.system_prompt || '').trim(),
              tools: [],
              temperature: 0,
              topP: 0,
              maxTokens: 0,
            },
          },
        },
        extensions: [],
      }, callOptions);
      const text = extractTextFromGenerateOutput(response.output);
      return {
        ...base,
        status: 'passed',
        traceId: String(response.traceId || callOptions.metadata.traceId || '').trim() || undefined,
        resolvedModel: String(response.modelResolved || input.fixture.model_id).trim(),
        artifactSummary: {
          textLength: text.length,
          textPreview: trimPreview(text),
          finishReason: Number(response.finishReason || 0),
        },
      };
    }

    if (input.fixture.capability === 'text.embed') {
      const callOptions = await buildRuntimeCallOptions({
        modId: DESKTOP_REPLAY_MOD_ID,
        timeoutMs: 120_000,
        source: resolved.source,
      });
      const response = await input.runtime.ai.executeScenario({
        head: {
          appId: input.runtime.appId,
          modelId: resolved.modelId,
          routePolicy: resolved.routePolicy,
          fallback: resolved.fallbackPolicy,
          timeoutMs: 120_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.TEXT_EMBED,
        executionMode: ExecutionMode.SYNC,
        spec: {
          spec: {
            oneofKind: 'textEmbed',
            textEmbed: {
              inputs: Array.isArray(input.fixture.request.inputs) ? input.fixture.request.inputs : [],
            },
          },
        },
        extensions: [],
      }, callOptions);
      const vectors = extractEmbeddings((response.output as { fields?: Record<string, unknown> } | undefined)?.fields?.vectors);
      return {
        ...base,
        status: 'passed',
        traceId: String(response.traceId || callOptions.metadata.traceId || '').trim() || undefined,
        resolvedModel: String(response.modelResolved || input.fixture.model_id).trim(),
        artifactSummary: {
          vectorCount: vectors.length,
        },
      };
    }

    if (input.fixture.capability === 'image.generate') {
      const metadata = await buildRuntimeRequestMetadata({
        source: resolved.source,
      });
      const response = await input.runtime.media.image.generate({
        model: resolved.modelId,
        prompt: String(input.fixture.request.prompt || '').trim(),
        negativePrompt: String(input.fixture.request.negative_prompt || '').trim() || undefined,
        route: resolved.source,
        fallback: 'deny',
        metadata,
      });
      return {
        ...base,
        status: 'passed',
        traceId: String(response.trace?.traceId || metadata.traceId || '').trim() || undefined,
        resolvedModel: String(response.trace?.modelResolved || input.fixture.model_id).trim(),
        jobId: String(response.job?.jobId || '').trim() || undefined,
        artifactSummary: summarizeArtifacts(response.artifacts as never),
      };
    }

    if (input.fixture.capability === 'audio.synthesize') {
      const metadata = await buildRuntimeRequestMetadata({
        source: resolved.source,
      });
      const response = await input.runtime.media.tts.synthesize({
        model: resolved.modelId,
        text: String(input.fixture.request.text || '').trim(),
        voice: String(input.fixture.voice_ref?.id || '').trim() || undefined,
        language: String(input.fixture.request.language || '').trim() || undefined,
        audioFormat: String(input.fixture.request.audio_format || '').trim() || undefined,
        route: resolved.source,
        fallback: 'deny',
        metadata,
      });
      return {
        ...base,
        status: 'passed',
        traceId: String(response.trace?.traceId || metadata.traceId || '').trim() || undefined,
        resolvedModel: String(response.trace?.modelResolved || input.fixture.model_id).trim(),
        jobId: String(response.job?.jobId || '').trim() || undefined,
        artifactSummary: summarizeArtifacts(response.artifacts as never),
      };
    }

    if (input.fixture.capability === 'audio.transcribe') {
      const metadata = await buildRuntimeRequestMetadata({
        source: resolved.source,
      });
      const audioBytes = decodeBase64Bytes(String(input.fixture.request.audio_base64 || '').trim());
      const response = await input.runtime.media.stt.transcribe({
        model: resolved.modelId,
        audio: audioBytes.length > 0
          ? {
            kind: 'bytes',
            bytes: audioBytes,
          }
          : {
            kind: 'url',
            url: String(input.fixture.request.audio_uri || '').trim(),
          },
        mimeType: String(input.fixture.request.mime_type || '').trim() || undefined,
        language: String(input.fixture.request.language || '').trim() || undefined,
        route: resolved.source,
        fallback: 'deny',
        metadata,
      });
      return {
        ...base,
        status: 'passed',
        traceId: String(response.trace?.traceId || metadata.traceId || '').trim() || undefined,
        resolvedModel: String(response.trace?.modelResolved || input.fixture.model_id).trim(),
        jobId: String(response.job?.jobId || '').trim() || undefined,
        artifactSummary: {
          textLength: String(response.text || '').trim().length,
          textPreview: trimPreview(String(response.text || '')),
        },
      };
    }

    const callOptions = await buildRuntimeCallOptions({
      modId: DESKTOP_REPLAY_MOD_ID,
      timeoutMs: 180_000,
      source: resolved.source,
    });
    const workflowRequest = input.fixture.capability === 'voice.clone'
      ? {
        head: {
          appId: input.runtime.appId,
          modelId: resolved.modelId,
          routePolicy: resolved.routePolicy,
          fallback: resolved.fallbackPolicy,
          timeoutMs: 180_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.VOICE_CLONE,
        executionMode: ExecutionMode.ASYNC_JOB,
        spec: {
          spec: {
            oneofKind: 'voiceClone',
            voiceClone: {
              targetModelId: String(input.fixture.target_model_id || '').trim(),
              input: {
                ...(String(input.fixture.request.audio_base64 || '').trim()
                  ? {
                    referenceAudioBytes: decodeBase64Bytes(String(input.fixture.request.audio_base64 || '').trim()),
                    referenceAudioMime: String(input.fixture.request.mime_type || '').trim() || undefined,
                  }
                  : {
                    referenceAudioUri: String(input.fixture.request.audio_uri || '').trim(),
                  }),
                ...(String(input.fixture.request.text || '').trim()
                  ? { text: String(input.fixture.request.text || '').trim() }
                  : {}),
              },
            },
          },
        },
        extensions: [],
      }
      : {
        head: {
          appId: input.runtime.appId,
          modelId: resolved.modelId,
          routePolicy: resolved.routePolicy,
          fallback: resolved.fallbackPolicy,
          timeoutMs: 180_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.VOICE_DESIGN,
        executionMode: ExecutionMode.ASYNC_JOB,
        spec: {
          spec: {
            oneofKind: 'voiceDesign',
            voiceDesign: {
              targetModelId: String(input.fixture.target_model_id || '').trim(),
              input: {
                instructionText: String(input.fixture.request.instruction_text || '').trim(),
              },
            },
          },
        },
        extensions: [],
      };
    const collected = await submitAndCollect(input.runtime, workflowRequest, callOptions.metadata);
    return {
      ...base,
      status: 'passed',
      traceId: collected.traceId || callOptions.metadata.traceId,
      resolvedModel: collected.modelResolved || input.fixture.model_id,
      jobId: collected.jobId,
      artifactSummary: {
        ...collected.summary,
        ...(collected.voiceAssetId ? { voiceAssetId: collected.voiceAssetId } : {}),
      },
    };
  } catch (error) {
    return withFailure(base, error);
  }
}
