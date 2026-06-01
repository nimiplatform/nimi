// App-owned dispatcher onto the admitted Runtime/SDK AI execution surface. Text
// generation routes through an AIConfig binding (source local/cloud + model id) —
// there is NO hardcoded provider/model and NO app-local provider routing. Image
// generation uses the runtime media surface with model "auto", i.e. the runtime
// chooses the route; Storybook never names a provider. Every failure is surfaced
// as a typed unavailable using the verbatim Runtime error.

import type { PlatformClient } from '@nimiplatform/sdk';
// Import the enum from the typed subpath, not the root barrel, so the app's AI
// code does not pull the SDK client (and its Node/gRPC transport graph) into the
// module graph. Client construction itself stays scaffold-managed (runtime-platform.ts).
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { AIConfig } from '@nimiplatform/sdk/ai';
// RuntimeRouteBinding is owned by the runtime route surface after the SDK refactor.
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/runtime';
import { createAIConfigEvidence } from '@nimiplatform/sdk/ai';
import { loadStorybookAIConfig } from './storybook-ai-config-store.js';
import { storybookAIUnavailable, type StorybookAIUnavailable, type StorybookAIUnavailableReason } from './storybook-unavailable.js';

const STORYBOOK_APP_ID = 'nimi.storybook';
const TEXT_BINDING_CAPABILITY = 'text.generate';

export type StorybookTextResult =
  | { ok: true; capability: 'text.generate'; text: string; finishReason: string; model: string; route: 'local' | 'cloud'; configHash: string; traceId?: string }
  | StorybookAIUnavailable;

export type StorybookImageResult =
  | { ok: true; capability: 'image.generate'; jobId: string; jobState: string; artifactCount: number; firstArtifactRef?: string; firstArtifactMime?: string }
  | StorybookAIUnavailable;

type ResolvedTextBinding = {
  binding: RuntimeRouteBinding;
  model: string;
  configHash: string;
  metadata: Record<string, string>;
};

function describeSdkError(error: unknown): string {
  if (!error) return 'Runtime SDK call failed with no error message.';
  if (error instanceof Error) {
    const reasonCode = (error as { reasonCode?: string }).reasonCode;
    const message = error.message || error.name || 'Runtime SDK call failed.';
    return reasonCode ? `${reasonCode}: ${message}` : message;
  }
  return String(error);
}

function reasonFromSdkError(error: unknown): StorybookAIUnavailableReason {
  const reasonCode = error && typeof error === 'object' && 'reasonCode' in error ? String((error as { reasonCode?: unknown }).reasonCode || '') : '';
  switch (reasonCode) {
    case ReasonCode.AUTH_CONTEXT_MISSING:
      return 'auth-context-missing';
    case ReasonCode.PRINCIPAL_UNAUTHORIZED:
    case ReasonCode.SESSION_EXPIRED:
    case ReasonCode.APP_TOKEN_EXPIRED:
    case ReasonCode.APP_TOKEN_REVOKED:
      return 'principal-unauthorized';
    case ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE:
      return 'sdk-method-unavailable';
    default:
      return 'runtime-call-failed';
  }
}

function buildMetadata(surfaceId: string, extra?: Record<string, string>): Record<string, string> {
  return { callerKind: 'third-party-app', callerId: STORYBOOK_APP_ID, surfaceId, ...(extra || {}) };
}

function bindingModel(binding: RuntimeRouteBinding): string {
  return String(binding.model || binding.modelId || binding.localModelId || '').trim();
}

/** Resolve the user-selected text route binding from AIConfig. Fails closed. */
export function resolveStorybookTextBinding(config: AIConfig = loadStorybookAIConfig()): ResolvedTextBinding | StorybookAIUnavailable {
  const binding = config.capabilities.selectedBindings[TEXT_BINDING_CAPABILITY] || null;
  if (!binding) {
    return storybookAIUnavailable('text.generate', 'ai-binding-missing', `No AIConfig binding selected for ${TEXT_BINDING_CAPABILITY}. Storybook fails closed before dispatch — it does not pick a provider for you.`);
  }
  const model = bindingModel(binding);
  if (!model) {
    return storybookAIUnavailable('text.generate', 'ai-binding-missing', `AIConfig binding for ${TEXT_BINDING_CAPABILITY} has no runtime model id.`);
  }
  const connectorId = String(binding.connectorId || '').trim();
  if (binding.source === 'local' && connectorId) {
    return storybookAIUnavailable('text.generate', 'ai-binding-missing', 'Local Runtime bindings must use connectorId="" and route by model id.');
  }
  if (binding.source === 'cloud' && !connectorId) {
    return storybookAIUnavailable('text.generate', 'ai-binding-missing', 'Cloud Runtime bindings require a connectorId.');
  }
  if (binding.source !== 'local' && binding.source !== 'cloud') {
    return storybookAIUnavailable('text.generate', 'ai-binding-missing', `Unsupported binding source "${String(binding.source)}".`);
  }
  const evidence = createAIConfigEvidence(config);
  return {
    binding,
    model,
    configHash: evidence.configHash,
    metadata: {
      aiConfigBindingSource: binding.source,
      aiConfigBindingConnectorId: binding.connectorId || '',
      aiConfigBindingModel: model,
      aiConfigHash: evidence.configHash,
    },
  };
}

function routeInput(binding: RuntimeRouteBinding, model: string): { model: string; connectorId?: string; route: 'local' | 'cloud' } {
  if (binding.source === 'cloud') {
    return { model, connectorId: String(binding.connectorId || '').trim(), route: 'cloud' };
  }
  return { model, route: 'local' };
}

function pickTraceId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.traceId === 'string' ? record.traceId : undefined;
}

/** Single-shot text generation via the AIConfig-resolved route. */
export async function invokeStorybookText(
  client: PlatformClient,
  input: { prompt: string; directive?: string; surfaceId: string },
  config: AIConfig = loadStorybookAIConfig(),
): Promise<StorybookTextResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return storybookAIUnavailable('text.generate', 'input-invalid', 'Text generation prompt is empty.');
  }
  const resolved = resolveStorybookTextBinding(config);
  if ('ok' in resolved && resolved.ok === false) return resolved;
  const bound = resolved as ResolvedTextBinding;
  const route = routeInput(bound.binding, bound.model);
  const directedPrompt = input.directive ? `${input.directive}\n\n${prompt}` : prompt;
  try {
    const output = await client.runtime.ai.text.generate({
      ...route,
      input: directedPrompt,
      metadata: buildMetadata(input.surfaceId, bound.metadata),
    });
    return {
      ok: true,
      capability: 'text.generate',
      text: output.text,
      finishReason: output.finishReason,
      model: bound.model,
      route: route.route,
      configHash: bound.configHash,
      traceId: pickTraceId(output.trace),
    };
  } catch (error) {
    return storybookAIUnavailable('text.generate', reasonFromSdkError(error), describeSdkError(error));
  }
}

function summariseArtifact(artifact: unknown): { ref?: string; mime?: string } {
  if (!artifact || typeof artifact !== 'object') return {};
  const record = artifact as Record<string, unknown>;
  const inline = record.inline as Record<string, unknown> | undefined;
  return {
    ref: typeof record.uri === 'string' ? record.uri : typeof record.artifactId === 'string' ? record.artifactId : undefined,
    mime: typeof record.mimeType === 'string' ? record.mimeType : typeof inline?.mimeType === 'string' ? (inline.mimeType as string) : undefined,
  };
}

function summariseJob(job: unknown): { jobId: string; jobState: string } {
  if (!job || typeof job !== 'object') return { jobId: '', jobState: 'unknown' };
  const record = job as Record<string, unknown>;
  return {
    jobId: typeof record.jobId === 'string' ? record.jobId : '',
    jobState: typeof record.state === 'string' ? record.state : typeof record.status === 'string' ? (record.status as string) : 'unknown',
  };
}

/**
 * Image generation through the runtime media surface. model "auto" defers route
 * selection to the runtime — Storybook never names a provider/model. Returns a
 * typed unavailable on any runtime contract failure.
 */
export async function invokeStorybookImage(
  client: PlatformClient,
  input: { prompt: string; surfaceId: string },
): Promise<StorybookImageResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return storybookAIUnavailable('image.generate', 'input-invalid', 'Image prompt is empty.');
  }
  try {
    const output = await client.runtime.media.image.generate({
      model: 'auto',
      prompt,
      metadata: buildMetadata(input.surfaceId),
    });
    const job = summariseJob(output.job);
    const first = summariseArtifact(output.artifacts[0]);
    return {
      ok: true,
      capability: 'image.generate',
      jobId: job.jobId,
      jobState: job.jobState,
      artifactCount: output.artifacts.length,
      firstArtifactRef: first.ref,
      firstArtifactMime: first.mime,
    };
  } catch (error) {
    return storybookAIUnavailable('image.generate', reasonFromSdkError(error), describeSdkError(error));
  }
}
