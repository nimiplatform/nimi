import { RoutePolicy } from '@nimiplatform/sdk/runtime/generated';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import type { NimiAISnapshot } from './conversation-capability';

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function requirePrompt(value: unknown): string {
  const prompt = normalizeText(value);
  if (!prompt) {
    throw createNimiError({
      message: 'agent text prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_text_prompt',
      source: 'runtime',
    });
  }
  return prompt;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeFiniteNumber(value: unknown): number | undefined {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

export function normalizePositiveFiniteNumber(value: unknown): number | undefined {
  const normalized = normalizeFiniteNumber(value);
  return normalized && normalized > 0 ? normalized : undefined;
}

export function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeOptionalNonNegativeNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function requireValue(value: unknown, reasonCode: string, actionHint: string, message: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message,
      reasonCode,
      actionHint,
      source: 'runtime',
    });
  }
  return normalized;
}

export function resolveExecutionSlice(
  snapshot: NimiAISnapshot | null | undefined,
  capability:
    | 'text.generate'
    | 'image.generate'
    | 'audio.synthesize'
    | 'audio.transcribe'
    | 'voice_workflow.voice_clone'
    | 'voice_workflow.voice_design',
): NonNullable<NimiAISnapshot['conversationCapabilitySlice']> {
  const slice = snapshot?.conversationCapabilitySlice;
  if (!slice || slice.capability !== capability || !slice.resolvedTarget) {
    throw createNimiError({
      message: `${capability} execution snapshot is not available`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'resolve_runtime_execution_target',
      source: 'runtime',
    });
  }
  return slice;
}

export function encodeBytesAsDataUrl(mimeType: string, bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function toRuntimeRoutePolicy(source: string): RoutePolicy {
  return source === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD;
}
