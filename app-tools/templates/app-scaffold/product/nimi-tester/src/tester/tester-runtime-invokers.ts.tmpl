// App-owned dispatcher that consumes the platform runtime client returned by
// the scaffold-managed AuthGate projection. Every capability lane wires to a
// real Runtime SDK call — no synthetic success, no fallback. Failures are
// translated to typed unavailable using the raw SDK error message so the
// developer sees verbatim what Runtime returned.

import type { PlatformClient } from '@nimiplatform/sdk';
import type { AIConfig, RuntimeRouteBinding } from '@nimiplatform/sdk/ai';
import { createAIConfigEvidence } from '@nimiplatform/sdk/ai';
import type { TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';
import { getTesterCapability } from './tester-capabilities.js';
import { loadTesterAIConfig } from './tester-ai-config-store.js';

export type TesterScenarioInput = {
  prompt: string;
  scenarioId: string;
};

export type TesterTrace = {
  traceId?: string;
  modelResolved?: string;
  routeDecision?: string;
};

export type TesterTypedOutput =
  | {
      kind: 'text';
      text: string;
      finishReason: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      streamed: boolean;
    }
  | {
      kind: 'embedding';
      vectorCount: number;
      dimensions: number;
      sample: number[];
      totalTokens?: number;
    }
  | {
      kind: 'artifacts';
      jobId: string;
      jobState: string;
      artifactCount: number;
      firstArtifact?: {
        artifactId?: string;
        mimeType?: string;
        url?: string;
        displayName?: string;
      };
    }
  | {
      kind: 'transcript';
      text: string;
      jobId: string;
      jobState: string;
      artifactCount: number;
    }
  | {
      kind: 'voice-catalog';
      modelResolved: string;
      voiceCount: number;
      sample: Array<{ voiceId: string; name: string; lang: string }>;
    };

export type TesterTypedSuccess = {
  ok: true;
  capabilityId: TesterCapabilityId;
  capabilityLabel: string;
  message: string;
  output: TesterTypedOutput;
  trace?: TesterTrace;
};

export type TesterInvocationResult = TesterTypedSuccess | TesterUnavailable;

const TESTER_APP_ID = 'nimi.tester';
const TEXT_GENERATION_BINDING_CAPABILITY = 'text.generate';
const EMBEDDING_BINDING_CAPABILITY = 'text.embed';

type ResolvedLLMBinding = {
  bindingCapabilityId: typeof TEXT_GENERATION_BINDING_CAPABILITY | typeof EMBEDDING_BINDING_CAPABILITY;
  binding: RuntimeRouteBinding;
  model: string;
  metadata: Record<string, string>;
};

function isTesterUnavailable(value: ResolvedLLMBinding | TesterUnavailable): value is TesterUnavailable {
  return 'ok' in value && value.ok === false;
}

function buildMetadata(surfaceId: string, extra?: Record<string, string | undefined>): Record<string, string> {
  const metadata: Record<string, string> = {
    callerKind: 'third-party-app',
    callerId: TESTER_APP_ID,
    surfaceId,
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value) metadata[key] = value;
  }
  return metadata;
}

function describeSdkError(error: unknown): string {
  if (!error) return 'Runtime SDK call failed with no error message.';
  if (error instanceof Error) {
    const message = error.message || error.name || 'Runtime SDK call failed.';
    const reasonCode = (error as { reasonCode?: string }).reasonCode;
    return reasonCode ? `${reasonCode}: ${message}` : message;
  }
  return String(error);
}

function unavailableFromError(capabilityId: TesterCapabilityId, error: unknown): TesterUnavailable {
  const capability = getTesterCapability(capabilityId);
  return capabilityUnavailable(capability, 'sdk-surface-missing', describeSdkError(error));
}

function unavailableFromValidation(capabilityId: TesterCapabilityId, message: string): TesterUnavailable {
  const capability = getTesterCapability(capabilityId);
  return capabilityUnavailable(capability, 'sdk-surface-missing', message);
}

function unavailableFromAIConfig(capabilityId: TesterCapabilityId, message: string): TesterUnavailable {
  const capability = getTesterCapability(capabilityId);
  return capabilityUnavailable(capability, 'ai-config-binding-missing', message);
}

function bindingCapabilityFor(capabilityId: TesterCapabilityId): ResolvedLLMBinding['bindingCapabilityId'] | null {
  if (capabilityId === 'text.generate' || capabilityId === 'chat.stream') {
    return TEXT_GENERATION_BINDING_CAPABILITY;
  }
  if (capabilityId === 'text.embed') {
    return EMBEDDING_BINDING_CAPABILITY;
  }
  return null;
}

function bindingModel(binding: RuntimeRouteBinding): string {
  return String(binding.model || binding.modelId || binding.localModelId || '').trim();
}

export function resolveTesterLLMBinding(
  capabilityId: TesterCapabilityId,
  config: AIConfig = loadTesterAIConfig(),
): ResolvedLLMBinding | TesterUnavailable {
  const bindingCapabilityId = bindingCapabilityFor(capabilityId);
  if (!bindingCapabilityId) {
    return unavailableFromAIConfig(capabilityId, `Capability ${capabilityId} does not have an AIConfig LLM binding path.`);
  }
  const binding = config.capabilities.selectedBindings[bindingCapabilityId] || null;
  if (!binding) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding is required for ${bindingCapabilityId}; Runtime invocation failed closed before request dispatch.`,
    );
  }
  const model = bindingModel(binding);
  if (!model) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} does not include a runtime model id.`,
    );
  }
  const connectorId = String(binding.connectorId || '').trim();
  if (binding.source === 'local' && connectorId) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} is local but includes connectorId; Runtime local bindings must use connectorId="" and route by model id.`,
    );
  }
  if (binding.source === 'cloud' && !connectorId) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} is cloud but does not include a runtime connectorId.`,
    );
  }
  if (binding.source !== 'local' && binding.source !== 'cloud') {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} has unsupported source "${String(binding.source)}".`,
    );
  }
  const evidence = createAIConfigEvidence(config);
  const scopeRef = config.scopeRef;
  return {
    bindingCapabilityId,
    binding,
    model,
    metadata: {
      aiConfigScopeKind: scopeRef.kind,
      aiConfigScopeOwnerId: scopeRef.ownerId,
      aiConfigScopeSurfaceId: scopeRef.surfaceId || '',
      aiConfigProfileId: config.profileOrigin?.profileId || '',
      aiConfigProfileTitle: config.profileOrigin?.title || '',
      aiConfigCapabilityId: capabilityId,
      aiConfigBindingCapabilityId: bindingCapabilityId,
      aiConfigBindingSource: binding.source,
      aiConfigBindingConnectorId: binding.connectorId || '',
      aiConfigBindingModel: model,
      aiConfigHash: evidence.configHash,
      aiConfigBindingKeys: evidence.capabilityBindingKeys.join(','),
    },
  };
}

function routeInput(binding: RuntimeRouteBinding, model: string): {
  model: string;
  connectorId?: string;
  route: 'local' | 'cloud';
} {
  const connectorId = String(binding.connectorId || '').trim();
  if (binding.source === 'cloud') {
    return {
      model,
      connectorId,
      route: 'cloud',
    };
  }
  return {
    model,
    route: 'local',
  };
}

function pickTrace(value: unknown): TesterTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    modelResolved: typeof record.modelResolved === 'string' ? record.modelResolved : undefined,
    routeDecision: typeof record.routeDecision === 'string' ? record.routeDecision : undefined,
  };
}

async function invokeTextGenerate(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('text.generate', 'Scenario prompt is empty — supply a request body before running text.generate.');
  }
  const resolved = resolveTesterLLMBinding('text.generate');
  if (isTesterUnavailable(resolved)) return resolved;
  const route = routeInput(resolved.binding, resolved.model);
  try {
    const output = await client.runtime.ai.text.generate({
      ...route,
      input: prompt,
      metadata: buildMetadata('nimi.tester.ai.text.generate', resolved.metadata),
    });
    return {
      ok: true,
      capabilityId: 'text.generate',
      capabilityLabel: getTesterCapability('text.generate').label,
      message: `Runtime accepted the prompt and returned ${output.text.length} characters.`,
      output: {
        kind: 'text',
        text: output.text,
        finishReason: output.finishReason,
        inputTokens: output.usage?.inputTokens,
        outputTokens: output.usage?.outputTokens,
        totalTokens: output.usage?.totalTokens,
        streamed: false,
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('text.generate', error);
  }
}

async function invokeChatStream(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('chat.stream', 'Scenario prompt is empty — supply a chat turn before running chat.stream.');
  }
  const resolved = resolveTesterLLMBinding('chat.stream');
  if (isTesterUnavailable(resolved)) return resolved;
  const route = routeInput(resolved.binding, resolved.model);
  try {
    const opened = await client.runtime.ai.text.stream({
      ...route,
      input: [{ role: 'user', content: prompt }],
      metadata: buildMetadata('nimi.tester.ai.chat.stream', resolved.metadata),
    });
    let aggregated = '';
    let finishReason = 'stop';
    let trace: TesterTrace | undefined;
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
    for await (const part of opened.stream) {
      if (part.type === 'delta') {
        aggregated += part.text;
      } else if (part.type === 'reasoning-delta') {
        // discard reasoning trace for the cockpit; surfaced via trace summary if available
      } else if (part.type === 'finish') {
        finishReason = part.finishReason;
        usage = part.usage || {};
        trace = pickTrace(part.trace);
      } else if (part.type === 'error') {
        return unavailableFromError('chat.stream', new Error(describeSdkError(part.error)));
      }
    }
    return {
      ok: true,
      capabilityId: 'chat.stream',
      capabilityLabel: getTesterCapability('chat.stream').label,
      message: `Stream completed with ${aggregated.length} characters (finishReason=${finishReason}).`,
      output: {
        kind: 'text',
        text: aggregated,
        finishReason,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        streamed: true,
      },
      trace,
    };
  } catch (error) {
    return unavailableFromError('chat.stream', error);
  }
}

async function invokeEmbedding(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('text.embed', 'Scenario prompt is empty — supply at least one input string for embedding.');
  }
  const resolved = resolveTesterLLMBinding('text.embed');
  if (isTesterUnavailable(resolved)) return resolved;
  const route = routeInput(resolved.binding, resolved.model);
  try {
    const output = await client.runtime.ai.embedding.generate({
      ...route,
      input: prompt,
      metadata: buildMetadata('nimi.tester.ai.embedding.generate', resolved.metadata),
    });
    const first = output.vectors[0] || [];
    return {
      ok: true,
      capabilityId: 'text.embed',
      capabilityLabel: getTesterCapability('text.embed').label,
      message: `Runtime returned ${output.vectors.length} vector(s) with ${first.length} dimensions.`,
      output: {
        kind: 'embedding',
        vectorCount: output.vectors.length,
        dimensions: first.length,
        sample: first.slice(0, 8),
        totalTokens: output.usage?.totalTokens,
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('text.embed', error);
  }
}

function summariseArtifact(artifact: unknown) {
  if (!artifact || typeof artifact !== 'object') return undefined;
  const record = artifact as Record<string, unknown>;
  const inline = record.inline as Record<string, unknown> | undefined;
  return {
    artifactId: typeof record.artifactId === 'string' ? record.artifactId : undefined,
    mimeType: typeof record.mimeType === 'string'
      ? record.mimeType
      : typeof inline?.mimeType === 'string' ? inline.mimeType : undefined,
    url: typeof record.uri === 'string'
      ? record.uri
      : typeof record.url === 'string' ? record.url : undefined,
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
  };
}

function summariseJob(job: unknown): { jobId: string; jobState: string } {
  if (!job || typeof job !== 'object') return { jobId: '', jobState: 'unknown' };
  const record = job as Record<string, unknown>;
  return {
    jobId: typeof record.jobId === 'string' ? record.jobId : '',
    jobState: typeof record.state === 'string'
      ? record.state
      : typeof record.status === 'string' ? (record.status as string) : 'unknown',
  };
}

async function invokeImageGenerate(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('image.generate', 'Scenario prompt is empty — supply an image prompt before running image.generate.');
  }
  try {
    const output = await client.runtime.media.image.generate({
      model: 'auto',
      prompt,
      metadata: buildMetadata('nimi.tester.media.image.generate'),
    });
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'image.generate',
      capabilityLabel: getTesterCapability('image.generate').label,
      message: `Runtime accepted the image job (state=${job.jobState}, ${output.artifacts.length} artifact(s)).`,
      output: {
        kind: 'artifacts',
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: output.artifacts.length,
        firstArtifact: summariseArtifact(output.artifacts[0]),
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('image.generate', error);
  }
}

async function invokeVideoGenerate(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('video.generate', 'Scenario prompt is empty — supply a video prompt before running video.generate.');
  }
  try {
    const output = await client.runtime.media.video.generate({
      mode: 't2v',
      model: 'auto',
      prompt,
      content: [{ type: 'text', role: 'prompt', text: prompt }],
      metadata: buildMetadata('nimi.tester.media.video.generate'),
    });
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'video.generate',
      capabilityLabel: getTesterCapability('video.generate').label,
      message: `Runtime accepted the video job (state=${job.jobState}, ${output.artifacts.length} artifact(s)).`,
      output: {
        kind: 'artifacts',
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: output.artifacts.length,
        firstArtifact: summariseArtifact(output.artifacts[0]),
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('video.generate', error);
  }
}

async function invokeSpeechSynthesize(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('audio.synthesize', 'Scenario prompt is empty — supply the text to synthesize before running audio.synthesize.');
  }
  try {
    const output = await client.runtime.media.tts.synthesize({
      model: 'auto',
      text: prompt,
      metadata: buildMetadata('nimi.tester.media.tts.synthesize'),
    });
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'audio.synthesize',
      capabilityLabel: getTesterCapability('audio.synthesize').label,
      message: `Runtime accepted the synthesis job (state=${job.jobState}, ${output.artifacts.length} artifact(s)).`,
      output: {
        kind: 'artifacts',
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: output.artifacts.length,
        firstArtifact: summariseArtifact(output.artifacts[0]),
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('audio.synthesize', error);
  }
}

async function invokeSpeechTranscribe(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const url = input.prompt.trim();
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://'))) {
    return unavailableFromValidation(
      'audio.transcribe',
      'audio.transcribe requires the scenario field to contain an http(s):// or file:// URL pointing at the audio asset.',
    );
  }
  try {
    const output = await client.runtime.media.stt.transcribe({
      model: 'auto',
      audio: { kind: 'url', url },
      metadata: buildMetadata('nimi.tester.media.stt.transcribe'),
    });
    const job = summariseJob(output.job);
    return {
      ok: true,
      capabilityId: 'audio.transcribe',
      capabilityLabel: getTesterCapability('audio.transcribe').label,
      message: `Runtime returned transcript (${output.text.length} chars, jobState=${job.jobState}).`,
      output: {
        kind: 'transcript',
        text: output.text,
        jobId: job.jobId,
        jobState: job.jobState,
        artifactCount: output.artifacts.length,
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('audio.transcribe', error);
  }
}

async function invokeSpeechBundle(client: PlatformClient, _input: TesterScenarioInput): Promise<TesterInvocationResult> {
  try {
    const output = await client.runtime.media.tts.listVoices({
      model: 'auto',
      metadata: buildMetadata('nimi.tester.media.tts.list-voices'),
    });
    return {
      ok: true,
      capabilityId: 'speech.bundle',
      capabilityLabel: getTesterCapability('speech.bundle').label,
      message: `Runtime returned ${output.voices.length} voice(s) from catalog "${output.voiceCatalogSource || 'default'}".`,
      output: {
        kind: 'voice-catalog',
        modelResolved: output.modelResolved,
        voiceCount: output.voiceCount ?? output.voices.length,
        sample: output.voices.slice(0, 4).map((voice) => ({
          voiceId: voice.voiceId,
          name: voice.name,
          lang: voice.lang,
        })),
      },
      trace: { traceId: output.traceId, modelResolved: output.modelResolved },
    };
  } catch (error) {
    return unavailableFromError('speech.bundle', error);
  }
}

export async function invokeTesterCapability(
  client: PlatformClient,
  capabilityId: TesterCapabilityId,
  input: TesterScenarioInput,
): Promise<TesterInvocationResult> {
  switch (capabilityId) {
    case 'text.generate':
      return invokeTextGenerate(client, input);
    case 'chat.stream':
      return invokeChatStream(client, input);
    case 'text.embed':
      return invokeEmbedding(client, input);
    case 'image.generate':
      return invokeImageGenerate(client, input);
    case 'video.generate':
      return invokeVideoGenerate(client, input);
    case 'audio.synthesize':
      return invokeSpeechSynthesize(client, input);
    case 'audio.transcribe':
      return invokeSpeechTranscribe(client, input);
    case 'speech.bundle':
      return invokeSpeechBundle(client, input);
    case 'world.generate':
      return unavailableFromValidation(
        'world.generate',
        'world.generate runs through the standalone Tauri viewer — use Resolve fixture / Open viewer, not the runtime invoker.',
      );
  }
}
