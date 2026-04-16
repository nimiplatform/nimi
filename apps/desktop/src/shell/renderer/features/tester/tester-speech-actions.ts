import { ExecutionMode, ScenarioJobStatus, ScenarioType } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { asString, isTerminalScenarioJobStatus, scenarioJobStatusLabel, stripArtifacts, toArtifactPreviewUri, toPrettyJson } from './tester-utils.js';
import { bindingToRouteInfo, createRuntimeTraceId, getRuntimeClient, resolveCallParams } from './tester-runtime.js';

const TESTER_VOICE_WORKFLOW_TIMEOUT_MS = 180_000;
const TESTER_VOICE_WORKFLOW_POLL_INTERVAL_MS = 500;
const ROUTE_POLICY_LOCAL = 1;
const ROUTE_POLICY_CLOUD = 2;

type RuntimeClientLike = ReturnType<typeof getRuntimeClient>;

type TesterSpeechActionDeps = {
  getRuntimeClientImpl?: () => RuntimeClientLike;
  resolveCallParamsImpl?: typeof resolveCallParams;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type TesterSpeechSuccess = {
  result: 'passed';
  output: unknown;
  rawResponse: string;
  diagnostics: {
    requestParams: Record<string, unknown>;
    resolvedRoute: ReturnType<typeof bindingToRouteInfo>;
    responseMetadata: {
      jobId?: string;
      artifactCount?: number;
      traceId?: string;
      modelResolved?: string;
      elapsed: number;
      finishReason?: string;
    };
  };
};

function localSpeechReasonSummary(reasonCode: string): string {
  switch (reasonCode) {
    case ReasonCode.AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED:
      return 'Local Speech preflight is blocked on this host.';
    case ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED:
      return 'Explicit download confirmation is required before Local Speech setup can continue.';
    case ReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED:
      return 'Local Speech environment initialization failed.';
    case ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED:
      return 'Local Speech host startup or probe failed.';
    case ReasonCode.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED:
      return 'The required Local Speech capability is missing and must be downloaded.';
    case ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED:
      return 'The Local Speech bundle is degraded and needs repair.';
    default:
      return '';
  }
}

function createTesterSpeechWorkflowError(input: {
  reasonCode: string;
  detail: string;
  fallbackMessage: string;
}): Error & { reasonCode?: string; details?: Record<string, unknown> } {
  const reasonCode = asString(input.reasonCode);
  const detail = asString(input.detail);
  const summary = localSpeechReasonSummary(reasonCode);
  const error = new Error(summary || detail || input.fallbackMessage) as Error & {
    reasonCode?: string;
    details?: Record<string, unknown>;
  };
  if (reasonCode) {
    error.reasonCode = reasonCode;
  }
  if (reasonCode || detail) {
    error.details = {
      ...(reasonCode ? { reason_code: reasonCode } : {}),
      ...(detail ? { detail } : {}),
    };
  }
  return error;
}

function nowMs(deps?: TesterSpeechActionDeps): number {
  return (deps?.now || Date.now)();
}

function toScenarioRoutePolicy(route: string | undefined): number {
  return String(route || '').trim().toLowerCase() === 'cloud'
    ? ROUTE_POLICY_CLOUD
    : ROUTE_POLICY_LOCAL;
}

async function waitForScenarioJobCompletion(input: {
  runtimeClient: RuntimeClientLike;
  jobId: string;
  timeoutMs: number;
  deps?: TesterSpeechActionDeps;
}): Promise<Record<string, unknown>> {
  const deadline = nowMs(input.deps) + input.timeoutMs;
  for (;;) {
    const response = await input.runtimeClient.ai.getScenarioJob({ jobId: input.jobId });
    const status = Number((response as unknown as { job?: { status?: number } }).job?.status || 0);
    if (status === ScenarioJobStatus.COMPLETED) {
      return response as unknown as Record<string, unknown>;
    }
    if (
      status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      const job = (response as unknown as { job?: Record<string, unknown> }).job || {};
      throw createTesterSpeechWorkflowError({
        reasonCode: asString(job.reasonCode),
        detail: asString(job.reasonDetail),
        fallbackMessage: `VOICE_WORKFLOW_${scenarioJobStatusLabel(status).toUpperCase()}`,
      });
    }
    if (nowMs(input.deps) >= deadline) {
      throw new Error(`VOICE_WORKFLOW_TIMEOUT:${input.jobId}`);
    }
    await (input.deps?.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(TESTER_VOICE_WORKFLOW_POLL_INTERVAL_MS);
  }
}

function makeVoiceWorkflowSuccess(input: {
  requestParams: Record<string, unknown>;
  binding: RuntimeRouteBinding | undefined;
  submitResponse: Record<string, unknown>;
  terminalJobResponse: Record<string, unknown>;
  assetResponse: Record<string, unknown> | null;
  elapsed: number;
}): TesterSpeechSuccess {
  const submitJob = (input.submitResponse.job || {}) as Record<string, unknown>;
  const terminalJob = (input.terminalJobResponse.job || {}) as Record<string, unknown>;
  const asset = (input.assetResponse?.asset || input.submitResponse.asset || {}) as Record<string, unknown>;
  return {
    result: 'passed',
    output: {
      workflowStatus: scenarioJobStatusLabel(terminalJob.status),
      voiceAssetId: asString(asset.voiceAssetId),
      providerVoiceRef: asString(asset.providerVoiceRef),
      status: asString(asset.status),
      preferredName: asString(asset.preferredName),
    },
    rawResponse: toPrettyJson({
      request: input.requestParams,
      submitResponse: input.submitResponse,
      terminalJob: input.terminalJobResponse,
      asset: input.assetResponse,
    }),
    diagnostics: {
      requestParams: input.requestParams,
      resolvedRoute: bindingToRouteInfo(input.binding),
      responseMetadata: {
        jobId: asString(submitJob.jobId) || asString(terminalJob.jobId) || undefined,
        traceId: asString(terminalJob.traceId) || asString(submitJob.traceId) || undefined,
        modelResolved: asString(terminalJob.modelResolved) || asString(submitJob.modelResolved) || undefined,
        finishReason: scenarioJobStatusLabel(terminalJob.status),
        elapsed: input.elapsed,
      },
    },
  };
}

export async function runTesterAudioSynthesize(input: {
  binding: RuntimeRouteBinding | undefined;
  text: string;
  voice: string;
  audioFormat: string;
}, deps?: TesterSpeechActionDeps): Promise<TesterSpeechSuccess> {
  const runtimeClient = (deps?.getRuntimeClientImpl || getRuntimeClient)();
  const callParams = await (deps?.resolveCallParamsImpl || resolveCallParams)(input.binding);
  const t0 = nowMs(deps);
  const requestParams: Record<string, unknown> = {
    text: input.text,
    voice: input.voice,
    audioFormat: input.audioFormat,
    ...(input.binding ? { binding: input.binding } : {}),
  };
  const result = await runtimeClient.media.tts.synthesize({
    model: callParams.model,
    route: callParams.route,
    connectorId: callParams.connectorId,
    text: input.text,
    voice: input.voice,
    audioFormat: input.audioFormat,
    metadata: callParams.metadata,
  });
  const artifact = result.artifacts[0];
  return {
    result: 'passed',
    output: {
      audioUri: toArtifactPreviewUri({ uri: artifact?.uri, bytes: artifact?.bytes, mimeType: artifact?.mimeType }),
      mimeType: asString(artifact?.mimeType),
      durationMs: Number(artifact?.durationMs || 0),
    },
    rawResponse: toPrettyJson({ request: requestParams, response: stripArtifacts(result) }),
    diagnostics: {
      requestParams,
      resolvedRoute: bindingToRouteInfo(input.binding),
      responseMetadata: {
        jobId: asString((result.job as unknown as Record<string, unknown>)?.jobId) || undefined,
        artifactCount: result.artifacts.length,
        traceId: asString(result.trace?.traceId) || undefined,
        modelResolved: asString(result.trace?.modelResolved) || undefined,
        elapsed: nowMs(deps) - t0,
      },
    },
  };
}

export async function runTesterAudioTranscribe(input: {
  binding: RuntimeRouteBinding | undefined;
  audio: { kind: 'url'; url: string } | { kind: 'bytes'; bytes: Uint8Array };
  language?: string;
  mimeType?: string;
}, deps?: TesterSpeechActionDeps): Promise<TesterSpeechSuccess> {
  const runtimeClient = (deps?.getRuntimeClientImpl || getRuntimeClient)();
  const callParams = await (deps?.resolveCallParamsImpl || resolveCallParams)(input.binding);
  const t0 = nowMs(deps);
  const requestParams: Record<string, unknown> = {
    audio: input.audio.kind === 'url'
      ? { kind: 'url', url: input.audio.url }
      : { kind: 'bytes', bytes: `[${input.audio.bytes.length} bytes]` },
    ...(input.language ? { language: input.language } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.binding ? { binding: input.binding } : {}),
  };
  const result = await runtimeClient.media.stt.transcribe({
    model: callParams.model,
    route: callParams.route,
    connectorId: callParams.connectorId,
    audio: input.audio,
    ...(input.language ? { language: input.language } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    metadata: callParams.metadata,
  });
  return {
    result: 'passed',
    output: result.text || '',
    rawResponse: toPrettyJson({ request: requestParams, response: result }),
    diagnostics: {
      requestParams,
      resolvedRoute: bindingToRouteInfo(input.binding),
      responseMetadata: {
        jobId: asString((result.job as unknown as Record<string, unknown>)?.jobId) || undefined,
        traceId: asString(result.trace?.traceId) || undefined,
        modelResolved: asString(result.trace?.modelResolved) || undefined,
        elapsed: nowMs(deps) - t0,
      },
    },
  };
}

export async function runTesterVoiceClone(input: {
  binding: RuntimeRouteBinding | undefined;
  prompt: string;
  preferredName?: string;
  referenceAudio: { kind: 'url'; url: string } | { kind: 'bytes'; bytes: Uint8Array };
  referenceAudioMime: string;
}, deps?: TesterSpeechActionDeps): Promise<TesterSpeechSuccess> {
  const runtimeClient = (deps?.getRuntimeClientImpl || getRuntimeClient)();
  const callParams = await (deps?.resolveCallParamsImpl || resolveCallParams)(input.binding);
  const t0 = nowMs(deps);
  const requestParams: Record<string, unknown> = {
    prompt: input.prompt,
    preferredName: asString(input.preferredName),
    referenceAudioMime: input.referenceAudioMime,
    referenceAudio: input.referenceAudio.kind === 'url'
      ? { kind: 'url', url: input.referenceAudio.url }
      : { kind: 'bytes', bytes: `[${input.referenceAudio.bytes.length} bytes]` },
    ...(input.binding ? { binding: input.binding } : {}),
  };
  const requestId = createRuntimeTraceId('tester-voice-clone');
  const submitResponse = await runtimeClient.ai.submitScenarioJob({
    head: {
      appId: runtimeClient.appId,
      modelId: callParams.model,
      routePolicy: toScenarioRoutePolicy(callParams.route),
      timeoutMs: TESTER_VOICE_WORKFLOW_TIMEOUT_MS,
      connectorId: callParams.connectorId || '',
    },
    scenarioType: ScenarioType.VOICE_CLONE,
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId,
    idempotencyKey: requestId,
    labels: {
      surface: 'desktop-tester',
      capability: 'voice_workflow.tts_v2v',
    },
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'voiceClone' as const,
        voiceClone: {
          targetModelId: callParams.model,
          input: {
            referenceAudioBytes: input.referenceAudio.kind === 'bytes' ? input.referenceAudio.bytes : new Uint8Array(),
            referenceAudioUri: input.referenceAudio.kind === 'url' ? input.referenceAudio.url : '',
            referenceAudioMime: input.referenceAudioMime,
            languageHints: [],
            preferredName: asString(input.preferredName),
            text: input.prompt,
          },
        },
      },
    },
  }, {
    timeoutMs: TESTER_VOICE_WORKFLOW_TIMEOUT_MS,
    metadata: callParams.metadata,
  });
  const submitRecord = submitResponse as unknown as Record<string, unknown>;
  const jobId = asString((submitRecord.job as Record<string, unknown> | undefined)?.jobId);
  if (!jobId) {
    throw new Error('TESTER_VOICE_CLONE_JOB_ID_REQUIRED');
  }
  const terminalJobResponse = await waitForScenarioJobCompletion({
    runtimeClient,
    jobId,
    timeoutMs: TESTER_VOICE_WORKFLOW_TIMEOUT_MS,
    deps,
  });
  const voiceAssetId = asString((submitRecord.asset as Record<string, unknown> | undefined)?.voiceAssetId);
  const assetResponse = voiceAssetId
    ? await runtimeClient.ai.getVoiceAsset({ voiceAssetId })
    : null;
  return makeVoiceWorkflowSuccess({
    requestParams,
    binding: input.binding,
    submitResponse: submitRecord,
    terminalJobResponse,
    assetResponse: assetResponse as unknown as Record<string, unknown> | null,
    elapsed: nowMs(deps) - t0,
  });
}

export async function runTesterVoiceDesign(input: {
  binding: RuntimeRouteBinding | undefined;
  instructionText: string;
  previewText: string;
  language?: string;
  preferredName?: string;
}, deps?: TesterSpeechActionDeps): Promise<TesterSpeechSuccess> {
  const runtimeClient = (deps?.getRuntimeClientImpl || getRuntimeClient)();
  const callParams = await (deps?.resolveCallParamsImpl || resolveCallParams)(input.binding);
  const t0 = nowMs(deps);
  const requestParams: Record<string, unknown> = {
    instructionText: input.instructionText,
    previewText: input.previewText,
    language: asString(input.language),
    preferredName: asString(input.preferredName),
    ...(input.binding ? { binding: input.binding } : {}),
  };
  const requestId = createRuntimeTraceId('tester-voice-design');
  const submitResponse = await runtimeClient.ai.submitScenarioJob({
    head: {
      appId: runtimeClient.appId,
      modelId: callParams.model,
      routePolicy: toScenarioRoutePolicy(callParams.route),
      timeoutMs: TESTER_VOICE_WORKFLOW_TIMEOUT_MS,
      connectorId: callParams.connectorId || '',
    },
    scenarioType: ScenarioType.VOICE_DESIGN,
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId,
    idempotencyKey: requestId,
    labels: {
      surface: 'desktop-tester',
      capability: 'voice_workflow.tts_t2v',
    },
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'voiceDesign' as const,
        voiceDesign: {
          targetModelId: callParams.model,
          input: {
            instructionText: input.instructionText,
            previewText: input.previewText,
            language: asString(input.language),
            preferredName: asString(input.preferredName),
          },
        },
      },
    },
  }, {
    timeoutMs: TESTER_VOICE_WORKFLOW_TIMEOUT_MS,
    metadata: callParams.metadata,
  });
  const submitRecord = submitResponse as unknown as Record<string, unknown>;
  const jobId = asString((submitRecord.job as Record<string, unknown> | undefined)?.jobId);
  if (!jobId) {
    throw new Error('TESTER_VOICE_DESIGN_JOB_ID_REQUIRED');
  }
  const terminalJobResponse = await waitForScenarioJobCompletion({
    runtimeClient,
    jobId,
    timeoutMs: TESTER_VOICE_WORKFLOW_TIMEOUT_MS,
    deps,
  });
  const voiceAssetId = asString((submitRecord.asset as Record<string, unknown> | undefined)?.voiceAssetId);
  const assetResponse = voiceAssetId
    ? await runtimeClient.ai.getVoiceAsset({ voiceAssetId })
    : null;
  return makeVoiceWorkflowSuccess({
    requestParams,
    binding: input.binding,
    submitResponse: submitRecord,
    terminalJobResponse,
    assetResponse: assetResponse as unknown as Record<string, unknown> | null,
    elapsed: nowMs(deps) - t0,
  });
}

export function buildTesterSpeechFailure(error: unknown, input: {
  fallbackMessage: string;
  requestParams: Record<string, unknown>;
  binding: RuntimeRouteBinding | undefined;
  elapsed: number;
}): {
  result: 'failed';
  error: string;
  rawResponse: string;
  diagnostics: {
    requestParams: Record<string, unknown>;
    resolvedRoute: ReturnType<typeof bindingToRouteInfo>;
    responseMetadata: {
      elapsed: number;
      finishReason?: string;
    };
  };
} {
  const details = (error as Record<string, unknown> | null)?.details as Record<string, unknown> | undefined;
  const reasonCode = asString((error as Record<string, unknown> | null)?.reasonCode) || asString(details?.reason_code);
  const speechReasonSummary = localSpeechReasonSummary(reasonCode);
  const baseMessage = speechReasonSummary || (error instanceof Error ? error.message : String(error || input.fallbackMessage));
  const providerMessage = details?.provider_message as string | undefined;
  const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
  return {
    result: 'failed',
    error: message,
    rawResponse: toPrettyJson({ request: input.requestParams, error: message, details }),
    diagnostics: {
      requestParams: input.requestParams,
      resolvedRoute: bindingToRouteInfo(input.binding),
      responseMetadata: {
        elapsed: input.elapsed,
        finishReason: details?.reason_code
          ? String(details.reason_code)
          : (isTerminalScenarioJobStatus(baseMessage) ? String(baseMessage) : undefined),
      },
    },
  };
}
