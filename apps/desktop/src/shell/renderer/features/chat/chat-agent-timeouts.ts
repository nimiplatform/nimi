import type { AIConfig } from './conversation-capability';
import { STREAM_TEXT_TOTAL_TIMEOUT_MS } from '../turns/stream-controller';

function resolvePositiveFiniteTimeoutMs(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function resolveAgentTurnTotalTimeoutMs(aiConfig: AIConfig): number {
  const imageCapabilityParams = aiConfig.capabilities.selectedParams['image.generate'] as Record<string, unknown> | null | undefined;
  const imageTimeoutMs = resolvePositiveFiniteTimeoutMs(imageCapabilityParams?.timeoutMs);
  if (!imageTimeoutMs) {
    return STREAM_TEXT_TOTAL_TIMEOUT_MS;
  }
  return Math.max(STREAM_TEXT_TOTAL_TIMEOUT_MS, imageTimeoutMs);
}
