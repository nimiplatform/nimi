import {
  runRuntimeImageGenerate,
  runRuntimeVideoGenerate,
  type RuntimeImageGenerateResult,
  type RuntimeVideoGenerateResult,
} from '@nimiplatform/kit/features/generation/runtime';
import { getTesterCapability } from './tester-capabilities.js';
import type { TesterInvocationResult, TesterRuntimeInvocationClient, TesterScenarioInput } from './tester-runtime-invokers-core.js';
import {
  buildMetadata,
  requireRuntimeSubjectUserId,
  unavailableFromError,
  unavailableFromValidation,
} from './tester-runtime-invokers-core.js';
import { TESTER_APP_ID, runtimeJobIdentity } from './tester-runtime-invokers-media-runtime.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';
import { loadTesterAIConfig } from './tester-ai-config-store.js';

type RuntimeRequestDiagnostics = NonNullable<TesterUnavailable['runtimeRequest']>;

export async function invokeImageGenerate(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('image.generate', 'Scenario prompt is empty — supply an image prompt before running image.generate.');
  }
  const subjectUserId = requireRuntimeSubjectUserId('image.generate', client);
  let runtimeRequestDiagnostics: RuntimeRequestDiagnostics | undefined;
  try {
    const identity = runtimeJobIdentity('image.generate', input.scenarioId);
    const result = await runRuntimeImageGenerate({
      runtime: {
        ai: client.runtime.ai,
        artifacts: imageArtifactReadClient(client),
        scheduling: client.runtime.scheduling,
        local: client.runtime.local,
      },
      appId: TESTER_APP_ID,
      config: loadTesterAIConfig(),
      prompt,
      scenarioId: identity.idempotencyKey,
      subjectUserId,
      surfaceId: 'nimi.tester.ai.image.generate',
      metadata: buildMetadata('nimi.tester.ai.image.generate'),
      onRuntimeRequest: (diagnostics) => {
        runtimeRequestDiagnostics = diagnostics;
      },
    });
    if (result.ok === false) {
      return unavailableFromKitImage(result, runtimeRequestDiagnostics);
    }
    return {
      ok: true,
      capabilityId: 'image.generate',
      capabilityLabel: getTesterCapability('image.generate').label,
      message: result.message,
      output: {
        kind: 'artifacts',
        jobId: result.output.jobId,
        jobState: result.output.jobStatus,
        artifactCount: result.output.artifactCount,
        firstArtifact: imageArtifactSummary(result),
      },
      trace: result.trace,
    };
  } catch (error) {
    return unavailableFromError('image.generate', error);
  }
}

function imageArtifactReadClient(client: TesterRuntimeInvocationClient) {
  if (!client.runtime.artifacts) return undefined;
  return {
    readArtifactBytes: async (request: { readonly artifactId: string }, _options?: unknown) => {
      const response = await client.runtime.artifacts?.readArtifactBytes(request);
      return {
        bytes: bytesFromArtifactResponse(response?.bytes),
        mimeType: response?.mimeType ?? '',
        sizeBytes: String(response?.sizeBytes ?? '0'),
        mimeInferred: false,
      };
    },
  };
}

function bytesFromArtifactResponse(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) {
    return new Uint8Array(value.filter((item) => Number.isInteger(item) && item >= 0 && item <= 255));
  }
  return new Uint8Array();
}

function unavailableFromKitImage(
  result: Extract<RuntimeImageGenerateResult, { ok: false }>,
  runtimeRequest?: RuntimeRequestDiagnostics,
): TesterInvocationResult {
  const reason: TesterUnavailableReason = result.reason === 'local-companion-missing'
    ? 'local-environment-blocked'
    : result.reason === 'local-environment-preparing' || result.reason === 'local-environment-blocked'
      ? result.reason
      : result.reason as TesterUnavailableReason;
  return withRuntimeRequest(
    capabilityUnavailable(getTesterCapability('image.generate'), reason, result.message),
    runtimeRequest,
  );
}

function imageArtifactSummary(result: Extract<RuntimeImageGenerateResult, { ok: true }>): {
  artifactId?: string;
  mimeType?: string;
  url?: string;
  displayName?: string;
} | undefined {
  const first = result.output.firstArtifact;
  if (!first) return undefined;
  return {
    artifactId: first.artifactId,
    mimeType: first.mimeType,
    url: first.uri || first.previewUrl,
    displayName: first.artifactId,
  };
}

export async function invokeVideoGenerate(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('video.generate', 'Scenario prompt is empty — supply a video prompt before running video.generate.');
  }
  const subjectUserId = requireRuntimeSubjectUserId('video.generate', client);
  let runtimeRequestDiagnostics: RuntimeRequestDiagnostics | undefined;
  try {
    const identity = runtimeJobIdentity('video.generate', input.scenarioId);
    const result = await runRuntimeVideoGenerate({
      runtime: {
        ai: client.runtime.ai,
        scheduling: client.runtime.scheduling,
      },
      appId: TESTER_APP_ID,
      config: loadTesterAIConfig(),
      prompt,
      scenarioId: identity.idempotencyKey,
      subjectUserId,
      surfaceId: 'nimi.tester.ai.video.generate',
      metadata: buildMetadata('nimi.tester.ai.video.generate'),
      onRuntimeRequest: (diagnostics) => {
        runtimeRequestDiagnostics = diagnostics;
      },
    });
    if (result.ok === false) {
      return unavailableFromKitVideo(result, runtimeRequestDiagnostics);
    }
    return {
      ok: true,
      capabilityId: 'video.generate',
      capabilityLabel: getTesterCapability('video.generate').label,
      message: result.message,
      output: {
        kind: 'artifacts',
        jobId: result.output.jobId,
        jobState: result.output.jobStatus,
        artifactCount: result.output.artifactCount,
        firstArtifact: videoArtifactSummary(result),
      },
      trace: result.trace,
    };
  } catch (error) {
    return unavailableFromError('video.generate', error);
  }
}

function unavailableFromKitVideo(
  result: Extract<RuntimeVideoGenerateResult, { ok: false }>,
  runtimeRequest?: RuntimeRequestDiagnostics,
): TesterInvocationResult {
  return withRuntimeRequest(
    capabilityUnavailable(getTesterCapability('video.generate'), result.reason as TesterUnavailableReason, result.message),
    runtimeRequest,
  );
}

function videoArtifactSummary(result: Extract<RuntimeVideoGenerateResult, { ok: true }>): {
  artifactId?: string;
  mimeType?: string;
  url?: string;
  displayName?: string;
} | undefined {
  const first = result.output.firstArtifact;
  if (!first) return undefined;
  return {
    artifactId: first.artifactId,
    mimeType: first.mimeType,
    url: first.uri || first.previewUrl,
    displayName: first.artifactId,
  };
}

function withRuntimeRequest(unavailable: TesterUnavailable, runtimeRequest?: RuntimeRequestDiagnostics): TesterInvocationResult {
  if (!runtimeRequest?.request) return unavailable;
  return {
    ...unavailable,
    runtimeRequest,
  };
}
