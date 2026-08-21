import {
  runRuntimeAIConsumeCapability,
  runRuntimeImageGenerate,
  runRuntimeMusicGenerate,
  runRuntimeSpeechSynthesize,
  runRuntimeSpeechTranscribe,
  runRuntimeVideoGenerate,
  runRuntimeVoiceCatalog,
  runtimeScenarioJobNonSuccessReasonFromError,
} from '@nimiplatform/kit/features/generation/runtime';
import {
  createNimiLocalAppRuntimeScenarioJobClient,
  type NimiLocalAppClient,
} from '@nimiplatform/sdk/app';
import type {
  StudioCapabilityRunInput,
  StudioCapabilityRunResult,
  StudioManagedArtifact,
  StudioNonSuccess,
  StudioNonSuccessDiagnostics,
  StudioNonSuccessReason,
  StudioRuntimeCapabilityDescriptor,
  StudioRuntimeInspection,
} from './runtime-types.js';
import {
  dispatchStudioCapabilityRuntime,
  type StudioCapabilityRuntimeHandlers,
} from './runtime-dispatcher.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type StudioRuntimeRunnerSet = {
  readonly aiConsume: typeof runRuntimeAIConsumeCapability;
  readonly imageGenerate: typeof runRuntimeImageGenerate;
  readonly musicGenerate: typeof runRuntimeMusicGenerate;
  readonly videoGenerate: typeof runRuntimeVideoGenerate;
  readonly speechSynthesize: typeof runRuntimeSpeechSynthesize;
  readonly speechTranscribe: typeof runRuntimeSpeechTranscribe;
  readonly voiceCatalog: typeof runRuntimeVoiceCatalog;
};

export type StudioCapabilityNonSuccessFactory = (
  capability: StudioRuntimeCapabilityDescriptor,
  reason: StudioNonSuccessReason,
  message: string,
  diagnostics?: StudioNonSuccessDiagnostics,
) => StudioNonSuccess;

export type StudioRuntimeHost = {
  readonly appId: string;
  readonly surfaceId: string;
  readonly abortReason: string;
  readonly client: NimiLocalAppClient;
  readonly createScenarioJobClient: typeof createNimiLocalAppRuntimeScenarioJobClient;
  readonly runners: StudioRuntimeRunnerSet;
  readonly nonSuccess: StudioCapabilityNonSuccessFactory;
};

export type StudioCapabilityRuntimeContext = {
  readonly capability: StudioRuntimeCapabilityDescriptor;
  readonly input: StudioCapabilityRunInput;
  readonly prompt: string;
  readonly scenarioId: string;
  readonly host: StudioRuntimeHost;
};

export type StudioCapabilityRuntimeOrchestrator = {
  readonly appId: string;
  readonly surfaceId: string;
  readonly abortReason: string;
  readonly handlers: StudioCapabilityRuntimeHandlers;
  readonly resolveCapability: (capabilityId: string) => StudioRuntimeCapabilityDescriptor;
  readonly inspectRuntime: () => Promise<StudioRuntimeInspection>;
  readonly getClient: () => NimiLocalAppClient;
  readonly createScenarioId: (capability: StudioRuntimeCapabilityDescriptor) => string;
  readonly createScenarioJobClient?: typeof createNimiLocalAppRuntimeScenarioJobClient;
  readonly runners?: Partial<StudioRuntimeRunnerSet>;
  readonly nonSuccess: StudioCapabilityNonSuccessFactory;
  readonly onMissingHandler?: (
    context: StudioCapabilityRuntimeContext,
  ) => StudioCapabilityRunResult | null | Promise<StudioCapabilityRunResult | null>;
};

export const DEFAULT_STUDIO_RUNTIME_RUNNERS: StudioRuntimeRunnerSet = Object.freeze({
  aiConsume: runRuntimeAIConsumeCapability,
  imageGenerate: runRuntimeImageGenerate,
  musicGenerate: runRuntimeMusicGenerate,
  videoGenerate: runRuntimeVideoGenerate,
  speechSynthesize: runRuntimeSpeechSynthesize,
  speechTranscribe: runRuntimeSpeechTranscribe,
  voiceCatalog: runRuntimeVoiceCatalog,
});

export function createStudioRuntimeRunnerSet(
  overrides: Partial<StudioRuntimeRunnerSet> = {},
): StudioRuntimeRunnerSet {
  return { ...DEFAULT_STUDIO_RUNTIME_RUNNERS, ...overrides };
}

export async function runStudioCapability(
  input: StudioCapabilityRunInput,
  orchestrator: StudioCapabilityRuntimeOrchestrator,
): Promise<StudioCapabilityRunResult> {
  const capability = orchestrator.resolveCapability(input.capabilityId);
  const runtime = await orchestrator.inspectRuntime();
  if (runtime.status !== 'connected') {
    return orchestrator.nonSuccess(capability, 'runtime-unavailable', runtime.detail);
  }

  const context: StudioCapabilityRuntimeContext = {
    capability,
    input,
    prompt: input.prompt.trim(),
    scenarioId: input.scenarioId?.trim() || orchestrator.createScenarioId(capability),
    host: {
      appId: orchestrator.appId,
      surfaceId: orchestrator.surfaceId,
      abortReason: orchestrator.abortReason,
      client: orchestrator.getClient(),
      createScenarioJobClient: orchestrator.createScenarioJobClient
        ?? createNimiLocalAppRuntimeScenarioJobClient,
      runners: createStudioRuntimeRunnerSet(orchestrator.runners),
      nonSuccess: orchestrator.nonSuccess,
    },
  };

  try {
    const dispatched = dispatchStudioCapabilityRuntime(orchestrator.handlers, context);
    if (dispatched) return await dispatched;
    if (!context.prompt) {
      return orchestrator.nonSuccess(
        capability,
        'input-invalid',
        `${capability.label} requires non-empty input.`,
      );
    }
    const hostProjection = orchestrator.onMissingHandler
      ? await orchestrator.onMissingHandler(context)
      : null;
    if (hostProjection) return hostProjection;
    return orchestrator.nonSuccess(
      capability,
      'sdk-method-unavailable',
      `No Runtime handler is registered for ${capability.id}.`,
    );
  } catch (error) {
    return projectStudioRuntimeError(context, error);
  }
}

export function createStudioScenarioJobClient(context: StudioCapabilityRuntimeContext) {
  return context.host.createScenarioJobClient(context.host.client.ai);
}

type ArtifactRunnerResult = Awaited<ReturnType<
  | typeof runRuntimeImageGenerate
  | typeof runRuntimeMusicGenerate
  | typeof runRuntimeVideoGenerate
  | typeof runRuntimeSpeechSynthesize
>>;

export async function projectStudioArtifactRunnerResult(
  context: StudioCapabilityRuntimeContext,
  result: ArtifactRunnerResult,
): Promise<StudioCapabilityRunResult> {
  if (result.ok === false) return projectStudioRunnerNonSuccess(context, result);
  const artifacts: StudioManagedArtifact[] = [];
  const adoptedPaths: string[] = [];
  try {
    for (const [index, sourceArtifact] of result.output.artifacts.entries()) {
      if (!sourceArtifact.artifactId) {
        throw new Error('Runtime artifact metadata omitted the custody artifact identifier required for adoption.');
      }
      const relativePath = await managedStudioAssetPath(
        context.capability.id,
        result.output.jobId,
        index,
      );
      const adopted = await context.host.client.storage.assets.adoptArtifact({
        artifactId: sourceArtifact.artifactId,
        relativePath,
        overwrite: false,
      });
      adoptedPaths.push(adopted.relativePath);
      artifacts.push({
        relativePath: adopted.relativePath,
        ...(adopted.mediaType ? { mediaType: adopted.mediaType } : {}),
        sizeBytes: adopted.sizeBytes,
        sha256: adopted.sha256,
        displayName: index === 0
          ? context.capability.label
          : `${context.capability.label} ${index + 1}`,
        previewSource: 'managed-asset',
      });
    }
  } catch (error) {
    const cleanupFailures: string[] = [];
    for (const relativePath of [...adoptedPaths].reverse()) {
      try {
        await context.host.client.storage.assets.remove(relativePath);
      } catch (cleanupError) {
        cleanupFailures.push(`${relativePath}: ${studioRuntimeErrorMessage(cleanupError)}`);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`${studioRuntimeErrorMessage(error)} Managed artifact cleanup also failed: ${cleanupFailures.join('; ')}`);
    }
    throw error;
  }
  return {
    ok: true,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: result.message,
    output: {
      kind: 'artifacts',
      jobId: result.output.jobId,
      jobState: result.output.jobStatus,
      artifactCount: result.output.artifactCount,
      artifacts,
      ...(artifacts[0] ? { firstArtifact: artifacts[0] } : {}),
    },
    ...(result.trace?.traceId ? { trace: { traceId: result.trace.traceId } } : {}),
  };
}

export function projectStudioRunnerNonSuccess(
  context: StudioCapabilityRuntimeContext,
  result: { readonly ok: false; readonly reason: string; readonly message: string; readonly error?: unknown },
): StudioNonSuccess {
  return context.host.nonSuccess(
    context.capability,
    studioNonSuccessReason(result.reason),
    result.message,
    studioNonSuccessDiagnostics(result.error),
  );
}

export function projectStudioRuntimeError(
  context: StudioCapabilityRuntimeContext,
  error: unknown,
): StudioNonSuccess {
  return context.host.nonSuccess(
    context.capability,
    studioNonSuccessReason(runtimeScenarioJobNonSuccessReasonFromError(error)),
    studioRuntimeErrorMessage(error),
    studioNonSuccessDiagnostics(error),
  );
}

export function studioNonSuccessReason(reason: string): StudioNonSuccessReason {
  if (reason === 'input-invalid' || reason === 'sdk-method-unavailable'
    || reason === 'principal-unauthorized' || reason === 'operation-aborted'
    || reason === 'runtime-canceled' || reason === 'runtime-timeout'
    || reason === 'stream-interrupted') {
    return reason;
  }
  return 'runtime-call-failed';
}

export function studioNonSuccessDiagnostics(error: unknown): StudioNonSuccessDiagnostics | undefined {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined;
  const record = error as Record<string, unknown>;
  const reasonCode = typeof record.reasonCode === 'string' ? record.reasonCode.trim() : '';
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(reasonCode)) return undefined;
  const rawActionHint = typeof record.actionHint === 'string' ? record.actionHint.trim() : '';
  const actionHint = /^[A-Za-z0-9_.-]{1,256}$/u.test(rawActionHint) ? rawActionHint : '';
  const rawTraceId = typeof record.traceId === 'string' ? record.traceId.trim() : '';
  const traceId = /^[A-Za-z0-9_.:-]{1,512}$/u.test(rawTraceId) ? rawTraceId : '';
  const source = record.source === 'runtime' || record.source === 'sdk' || record.source === 'realm'
    ? record.source
    : '';
  return {
    reasonCode,
    ...(actionHint ? { actionHint } : {}),
    ...(traceId ? { traceId } : {}),
    ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
    ...(source ? { source } : {}),
  };
}

export function studioRuntimeErrorMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const message = error instanceof Error ? error.message.trim() : '';
  const reasonCode = typeof record?.reasonCode === 'string' ? record.reasonCode.trim() : '';
  if (message && reasonCode) return `${message} (${reasonCode})`;
  return message || reasonCode || String(error || 'The Runtime capability call failed.');
}

export function studioAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

async function managedStudioAssetPath(
  capabilityId: string,
  jobId: string,
  artifactIndex: number,
): Promise<string> {
  const identity = artifactIndex === 0 ? jobId : `${jobId}:${artifactIndex}`;
  const bytes = new TextEncoder().encode(identity);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const token = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `media/${capabilityId.replaceAll('.', '-')}/${token}.asset`;
}
