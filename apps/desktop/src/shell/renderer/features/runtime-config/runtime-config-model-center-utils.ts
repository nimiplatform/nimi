import type {
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalTransferSessionSummary,
  NimiRuntimeLocalDownloadState,
  NimiRuntimeLocalTransferProgressEvent,
  NimiRuntimeLocalInstallPlanDescriptor,
} from '@nimiplatform/sdk/runtime';
import { isNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import {
  getNimiRuntimeReasonCodeMessage,
  NIMI_RUNTIME_REASON_CODES,
  NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS,
  normalizeNimiRuntimeLocalRunnableAssetKindId,
  type NimiRuntimeLocalRunnableAssetKindId,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

export type LocalModelCenterProps = {
  state: RuntimeConfigStateV11;
  checkingHealth: boolean;
  onHealthCheck: () => Promise<void>;
  onInstallCatalogItem: (
    item: NimiRuntimeLocalCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      hashes?: Record<string, string>;
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  onInstallCatalogAsset: (templateId: string) => Promise<void>;
};

export const CAPABILITY_OPTIONS = NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS;
export type CapabilityOption = NimiRuntimeLocalRunnableAssetKindId;
export type ProgressSessionState = {
  event: NimiRuntimeLocalTransferProgressEvent;
  updatedAtMs: number;
  createdAtMs: number;
  installSource?: 'catalog' | 'manual' | 'verified';
};

export const PROGRESS_SESSION_LIMIT = 6;
export const PROGRESS_RETENTION_MS = 15 * 60 * 1000;
export const HIGHLIGHT_CLEAR_MS = 8000;

export function isDownloadTerminal(state: NimiRuntimeLocalDownloadState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function deriveDoneSuccessFromState(state: NimiRuntimeLocalDownloadState): { done: boolean; success: boolean } {
  if (state === 'completed') {
    return { done: true, success: true };
  }
  if (state === 'failed' || state === 'cancelled') {
    return { done: true, success: false };
  }
  return { done: false, success: false };
}

export function toProgressEventFromSummary(
  summary: NimiRuntimeLocalTransferSessionSummary,
): NimiRuntimeLocalTransferProgressEvent {
  const terminal = deriveDoneSuccessFromState(summary.state);
  return {
    installSessionId: summary.installSessionId,
    modelId: summary.modelId,
    sessionKind: summary.sessionKind,
    phase: summary.phase,
    bytesReceived: summary.bytesReceived,
    bytesTotal: summary.bytesTotal,
    speedBytesPerSec: summary.speedBytesPerSec,
    etaSeconds: summary.etaSeconds,
    message: summary.message,
    state: summary.state,
    reasonCode: summary.reasonCode,
    retryable: summary.retryable,
    done: terminal.done,
    success: terminal.success,
  };
}

export function downloadStateLabel(state: NimiRuntimeLocalDownloadState): string {
  if (state === 'queued') return 'Queued';
  if (state === 'running') return 'Running';
  if (state === 'paused') return 'Paused';
  if (state === 'failed') return 'Failed';
  if (state === 'completed') return 'Completed';
  return 'Cancelled';
}

export function formatBytes(value: number | undefined): string {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (safe <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let next = safe;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : unitIndex >= 3 ? 2 : 1;
  return `${next.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatKnownDownloadSize(value: number | undefined, unknownLabel: string): string {
  const safe = Number(value);
  return Number.isFinite(safe) && safe > 0 ? formatBytes(safe) : unknownLabel;
}

export function isRuntimeInstallCancellation(error: unknown): boolean {
  return isNimiError(error)
    && error.reasonCode === NIMI_RUNTIME_REASON_CODES.AI_LOCAL_EXECUTION_CANCELED;
}

export function formatSpeed(value: number | undefined): string {
  const safe = Number(value);
  if (!Number.isFinite(safe) || safe <= 0) return '-';
  return `${formatBytes(safe)}/s`;
}

export function formatEta(seconds: number | undefined): string {
  const safe = Number(seconds);
  if (!Number.isFinite(safe) || safe < 0) return '-';
  if (safe < 60) return `${Math.ceil(safe)}s`;
  const minutes = Math.floor(safe / 60);
  const remain = Math.ceil(safe % 60);
  return `${minutes}m ${remain}s`;
}

export function formatDownloadPhaseLabel(phase: string | undefined): string {
  const normalized = String(phase || '').trim().toLowerCase();
  if (normalized === 'verify') return 'Verifying';
  if (normalized === 'upsert') return 'Finalizing';
  if (normalized === 'download') return 'Downloading';
  return normalized || 'Preparing';
}

export function formatImportPhaseLabel(phase: string | undefined): string {
  const normalized = String(phase || '').trim().toLowerCase();
  if (normalized === 'copy') return 'Copying';
  if (normalized === 'move') return 'Moving';
  if (normalized === 'manifest') return 'Writing manifest';
  if (normalized === 'register' || normalized === 'upsert') return 'Registering';
  return normalized || 'Preparing';
}

export function normalizeCapabilityOption(value: string | undefined): CapabilityOption {
  return normalizeNimiRuntimeLocalRunnableAssetKindId(value);
}

export function basenameFromRuntimePath(value: string | undefined): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/').filter(Boolean);
  return String(parts[parts.length - 1] || '').trim();
}

export function planRequiresAttachedEndpointInput(plan: NimiRuntimeLocalInstallPlanDescriptor | null | undefined): boolean {
  return Boolean(plan && plan.engineRuntimeMode === 'attached-endpoint');
}

export function planInstallAvailable(plan: NimiRuntimeLocalInstallPlanDescriptor | null | undefined): boolean {
  return plan == null ? true : Boolean(plan.installAvailable);
}

export function localSpeechReasonSummary(reasonCode: string | undefined): string {
  switch (String(reasonCode || '').trim()) {
    case ReasonCode.AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED:
      return 'Runtime could not start the local speech capability on this host.';
    case ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED:
      return 'Explicit download confirmation is required before Local Speech setup can continue.';
    case ReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED:
      return 'Runtime local speech environment initialization failed.';
    case ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED:
      return 'Runtime could not start the local speech capability.';
    case ReasonCode.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED:
      return 'A required Runtime local speech asset is missing.';
    case ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED:
      return 'The Runtime local speech bundle is unavailable.';
    default:
      return '';
  }
}

// Human-readable summary for an unhealthy asset's reason code. Prefers the
// speech-specific copy, then falls back to the canonical Runtime reason-code
// message catalog. Returns ''
// for an unmapped code so callers render a generic message instead of leaking
// the raw machine identifier to the user.
export function assetUnhealthyReasonSummary(reasonCode: string | undefined): string {
  const speechSummary = localSpeechReasonSummary(reasonCode);
  if (speechSummary) {
    return speechSummary;
  }
  return getNimiRuntimeReasonCodeMessage(reasonCode)?.defaultMessage || '';
}

export function planBlocksCanonicalImageImport(plan: NimiRuntimeLocalInstallPlanDescriptor | null | undefined): boolean {
  const reasonCode = String(plan?.reasonCode || '').trim();
  return reasonCode === ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE;
}

export function planCanonicalImageCompatibilityHint(plan: NimiRuntimeLocalInstallPlanDescriptor | null | undefined): string {
  if (!planBlocksCanonicalImageImport(plan)) {
    return '';
  }
  return planBlockingHint(plan);
}

export function planBlockingHint(plan: NimiRuntimeLocalInstallPlanDescriptor | null | undefined): string {
  if (planInstallAvailable(plan)) {
    return '';
  }
  const warning = String(plan?.warnings?.[0] || '').trim();
  if (warning) {
    return warning;
  }
  const speechReasonSummary = localSpeechReasonSummary(plan?.reasonCode);
  if (speechReasonSummary) {
    return speechReasonSummary;
  }
  if (planRequiresAttachedEndpointInput(plan)) {
    return `Attached endpoint required for ${String(plan?.engine || 'this runtime').trim() || 'this runtime'}.`;
  }
  return 'This asset is not available on the current host.';
}

export function parseTimestamp(value: string | undefined): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function pruneProgressSessions(
  sessions: Record<string, ProgressSessionState>,
  nowMs: number,
): Record<string, ProgressSessionState> {
  let changed = false;
  const next: Record<string, ProgressSessionState> = {};
  for (const [sessionId, state] of Object.entries(sessions)) {
    const expired = state.event.done && (nowMs - state.updatedAtMs > PROGRESS_RETENTION_MS);
    if (expired) {
      changed = true;
      continue;
    }
    next[sessionId] = state;
  }
  return changed ? next : sessions;
}

function isInteractiveDownloadState(state: NimiRuntimeLocalDownloadState): boolean {
  return state === 'queued' || state === 'running' || state === 'paused' || state === 'failed';
}

export function sortProgressSessions(
  sessions: Record<string, ProgressSessionState>,
): ProgressSessionState[] {
  return Object.values(sessions).sort((left, right) => {
    const leftInteractive = isInteractiveDownloadState(left.event.state);
    const rightInteractive = isInteractiveDownloadState(right.event.state);
    if (leftInteractive !== rightInteractive) {
      return leftInteractive ? -1 : 1;
    }
    if (leftInteractive) {
      if (left.createdAtMs !== right.createdAtMs) {
        return left.createdAtMs - right.createdAtMs;
      }
      return left.event.installSessionId.localeCompare(right.event.installSessionId);
    }
    if (left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs;
    }
    if (left.createdAtMs !== right.createdAtMs) {
      return right.createdAtMs - left.createdAtMs;
    }
    return right.event.installSessionId.localeCompare(left.event.installSessionId);
  });
}
