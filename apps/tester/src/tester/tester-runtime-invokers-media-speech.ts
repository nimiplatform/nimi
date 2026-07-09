import {
  runRuntimeSpeechSynthesize,
  runRuntimeSpeechTranscribe,
  runRuntimeVoiceCatalog,
  type RuntimeSpeechSynthesizeResult,
  type RuntimeSpeechTranscribeResult,
  type RuntimeVoiceCatalogResult,
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
import { hydrateTesterAIConfigFromStandardShell } from './tester-ai-config-store.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';

type RuntimeRequestDiagnostics = NonNullable<TesterUnavailable['runtimeRequest']>;

export async function invokeSpeechSynthesize(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('audio.synthesize', 'Scenario prompt is empty — supply the text to synthesize before running audio.synthesize.');
  }
  const subjectUserId = requireRuntimeSubjectUserId('audio.synthesize', client);
  let runtimeRequestDiagnostics: RuntimeRequestDiagnostics | undefined;
  try {
    const identity = runtimeJobIdentity('audio.synthesize', input.scenarioId);
    const result = await runRuntimeSpeechSynthesize({
      runtime: {
        ai: client.runtime.ai,
        scheduling: client.runtime.scheduling,
        local: client.runtime.local,
      },
      appId: TESTER_APP_ID,
      config: await hydrateTesterAIConfigFromStandardShell(),
      text: prompt,
      scenarioId: identity.idempotencyKey,
      subjectUserId,
      surfaceId: 'nimi.tester.ai.speech.synthesize',
      metadata: buildMetadata('nimi.tester.ai.speech.synthesize'),
      onRuntimeRequest: (diagnostics) => {
        runtimeRequestDiagnostics = diagnostics;
      },
    });
    if (result.ok === false) {
      return unavailableFromKitSpeech(result, runtimeRequestDiagnostics);
    }
    return {
      ok: true,
      capabilityId: 'audio.synthesize',
      capabilityLabel: getTesterCapability('audio.synthesize').label,
      message: result.message,
      output: {
        kind: 'artifacts',
        jobId: result.output.jobId,
        jobState: result.output.jobStatus,
        artifactCount: result.output.artifactCount,
        firstArtifact: speechArtifactSummary(result),
      },
      trace: result.trace,
    };
  } catch (error) {
    return unavailableFromError('audio.synthesize', error);
  }
}

function unavailableFromKitSpeech(
  result: Extract<RuntimeSpeechSynthesizeResult, { ok: false }>,
  runtimeRequest?: RuntimeRequestDiagnostics,
): TesterInvocationResult {
  return withRuntimeRequest(
    capabilityUnavailable(
      getTesterCapability('audio.synthesize'),
      result.reason as TesterUnavailableReason,
      result.message,
    ),
    runtimeRequest,
  );
}

function speechArtifactSummary(result: Extract<RuntimeSpeechSynthesizeResult, { ok: true }>): {
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

export async function invokeSpeechTranscribe(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const url = input.prompt.trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://'))) {
    return unavailableFromValidation(
      'audio.transcribe',
      'audio.transcribe requires the scenario field to contain an http(s):// or file:// URL pointing at the audio asset.',
    );
  }
  const subjectUserId = requireRuntimeSubjectUserId('audio.transcribe', client);
  let runtimeRequestDiagnostics: RuntimeRequestDiagnostics | undefined;
  try {
    const identity = runtimeJobIdentity('audio.transcribe', input.scenarioId);
    const result = await runRuntimeSpeechTranscribe({
      runtime: {
        ai: client.runtime.ai,
        scheduling: client.runtime.scheduling,
      },
      appId: TESTER_APP_ID,
      config: await hydrateTesterAIConfigFromStandardShell(),
      audioUrl: url,
      scenarioId: identity.idempotencyKey,
      subjectUserId,
      surfaceId: 'nimi.tester.ai.speech.transcribe',
      metadata: buildMetadata('nimi.tester.ai.speech.transcribe'),
      onRuntimeRequest: (diagnostics) => {
        runtimeRequestDiagnostics = diagnostics;
      },
    });
    if (result.ok === false) {
      return unavailableFromKitTranscribe(result, runtimeRequestDiagnostics);
    }
    return {
      ok: true,
      capabilityId: 'audio.transcribe',
      capabilityLabel: getTesterCapability('audio.transcribe').label,
      message: result.message,
      output: {
        kind: 'transcript',
        text: result.output.text,
        jobId: result.output.jobId,
        jobState: result.output.jobStatus,
        artifactCount: result.output.artifactCount,
      },
      trace: result.trace,
    };
  } catch (error) {
    return unavailableFromError('audio.transcribe', error);
  }
}

function unavailableFromKitTranscribe(
  result: Extract<RuntimeSpeechTranscribeResult, { ok: false }>,
  runtimeRequest?: RuntimeRequestDiagnostics,
): TesterInvocationResult {
  return withRuntimeRequest(
    capabilityUnavailable(
      getTesterCapability('audio.transcribe'),
      result.reason as TesterUnavailableReason,
      result.message,
    ),
    runtimeRequest,
  );
}

export async function invokeSpeechBundle(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const subjectUserId = requireRuntimeSubjectUserId('speech.bundle', client);
  let runtimeRequestDiagnostics: RuntimeRequestDiagnostics | undefined;
  try {
    const result = await runRuntimeVoiceCatalog({
      runtime: {
        ai: client.runtime.ai,
        scheduling: client.runtime.scheduling,
      },
      appId: TESTER_APP_ID,
      config: await hydrateTesterAIConfigFromStandardShell(),
      bindingCapabilityId: 'audio.synthesize',
      scenarioId: input.scenarioId,
      subjectUserId,
      surfaceId: 'nimi.tester.ai.speech.bundle',
      metadata: buildMetadata('nimi.tester.ai.speech.bundle'),
      onRuntimeRequest: (diagnostics) => {
        runtimeRequestDiagnostics = diagnostics;
      },
    });
    if (result.ok === false) {
      return unavailableFromKitVoiceCatalog(result, runtimeRequestDiagnostics);
    }
    return {
      ok: true,
      capabilityId: 'speech.bundle',
      capabilityLabel: getTesterCapability('speech.bundle').label,
      message: result.message,
      output: {
        kind: 'voice-catalog',
        modelResolved: result.output.modelResolved,
        voiceCount: result.output.voiceCount,
        sample: result.output.sample.map((voice) => ({ ...voice })),
      },
      trace: result.trace,
    };
  } catch (error) {
    return unavailableFromError('speech.bundle', error);
  }
}

function unavailableFromKitVoiceCatalog(
  result: Extract<RuntimeVoiceCatalogResult, { ok: false }>,
  runtimeRequest?: RuntimeRequestDiagnostics,
): TesterInvocationResult {
  return withRuntimeRequest(
    capabilityUnavailable(
      getTesterCapability('speech.bundle'),
      result.reason as TesterUnavailableReason,
      result.message,
    ),
    runtimeRequest,
  );
}

function withRuntimeRequest(unavailable: TesterUnavailable, runtimeRequest?: RuntimeRequestDiagnostics): TesterInvocationResult {
  if (!runtimeRequest?.request) return unavailable;
  return {
    ...unavailable,
    runtimeRequest,
  };
}
