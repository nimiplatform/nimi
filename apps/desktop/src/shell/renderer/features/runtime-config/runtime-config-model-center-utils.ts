import type {
  LocalAiCatalogItemDescriptor,
  LocalAiDependencyResolutionPlan,
  LocalAiDownloadSessionSummary,
  LocalAiDownloadState,
  LocalAiDownloadProgressEvent,
  LocalAiInstallPayload,
  LocalAiInstallPlanDescriptor,
} from '@runtime/local-ai-runtime';
import type { RuntimeDependencyTargetDescriptor } from './runtime-config-panel-types';
import type { RuntimeConfigStateV11, RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

export type LocalRuntimeModelCenterProps = {
  state: RuntimeConfigStateV11;
  discovering: boolean;
  checkingHealth: boolean;
  displayMode?: 'runtime' | 'mod';
  lockedDependencyModId?: string;
  runtimeDependencyTargets: RuntimeDependencyTargetDescriptor[];
  selectedDependencyModId?: string;
  onSelectDependencyModId?: (modId: string) => void;
  localRuntimeModelQuery: string;
  filteredLocalRuntimeModels: string[];
  onDiscover: () => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onResolveDependencies: (modId: string, capability?: string) => Promise<LocalAiDependencyResolutionPlan>;
  onApplyDependencies: (modId: string, capability?: string) => Promise<void>;
  onInstallCatalogItem: (
    item: LocalAiCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  onInstall: (payload: LocalAiInstallPayload) => Promise<void>;
  onInstallVerified: (templateId: string) => Promise<void>;
  onImport: () => Promise<void>;
  onInstallVerifiedArtifact: (templateId: string) => Promise<void>;
  onImportArtifact: () => Promise<void>;
  onImportFile: (capabilities: string[], engine?: string) => Promise<void>;
  onStart: (localModelId: string) => Promise<void>;
  onStop: (localModelId: string) => Promise<void>;
  onRestart: (localModelId: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
  onRemoveArtifact: (localArtifactId: string) => Promise<void>;
  onSetLocalRuntimeModelQuery: (value: string) => void;
  onChangeLocalRuntimeEndpoint: (endpoint: string) => void;
  onNavigateToSetup?: (pageId: RuntimeSetupPageIdV11) => void;
  onDownloadComplete?: (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => Promise<void>;
  onRetryInstall?: (plan: LocalAiInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => void;
  installSessionMeta?: Map<string, { plan: LocalAiInstallPlanDescriptor; installSource: string }>;
};

export const CAPABILITY_OPTIONS = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
export type CapabilityOption = typeof CAPABILITY_OPTIONS[number];
export const INSTALL_ENGINE_OPTIONS = ['localai', 'nexa'] as const;
export type InstallEngineOption = typeof INSTALL_ENGINE_OPTIONS[number];
export type ProgressSessionState = {
  event: LocalAiDownloadProgressEvent;
  updatedAtMs: number;
  createdAtMs: number;
  installSource?: 'catalog' | 'manual' | 'verified';
};

export const PROGRESS_SESSION_LIMIT = 6;
export const PROGRESS_RETENTION_MS = 15 * 60 * 1000;
export const HIGHLIGHT_CLEAR_MS = 8000;

export function isDownloadTerminal(state: LocalAiDownloadState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function deriveDoneSuccessFromState(state: LocalAiDownloadState): { done: boolean; success: boolean } {
  if (state === 'completed') {
    return { done: true, success: true };
  }
  if (state === 'failed' || state === 'cancelled') {
    return { done: true, success: false };
  }
  return { done: false, success: false };
}

export function toProgressEventFromSummary(
  summary: LocalAiDownloadSessionSummary,
): LocalAiDownloadProgressEvent {
  const terminal = deriveDoneSuccessFromState(summary.state);
  return {
    installSessionId: summary.installSessionId,
    modelId: summary.modelId,
    localModelId: summary.localModelId || undefined,
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

export function downloadStateLabel(state: LocalAiDownloadState): string {
  if (state === 'queued') return 'Queued';
  if (state === 'running') return 'Running';
  if (state === 'paused') return 'Paused';
  if (state === 'failed') return 'Failed';
  if (state === 'completed') return 'Completed';
  return 'Cancelled';
}

export function statusLabel(value: string): 'healthy' | 'degraded' | 'idle' | 'unreachable' {
  if (value === 'active') return 'healthy';
  if (value === 'unhealthy') return 'degraded';
  if (value === 'installed') return 'idle';
  return 'unreachable';
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

export function normalizeCapabilityOption(value: string | undefined): CapabilityOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (CAPABILITY_OPTIONS.find((item) => item === normalized) || 'chat') as CapabilityOption;
}

export function normalizeInstallEngine(value: string | undefined): InstallEngineOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (INSTALL_ENGINE_OPTIONS.find((item) => item === normalized) || 'localai') as InstallEngineOption;
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

function isInteractiveDownloadState(state: LocalAiDownloadState): boolean {
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

export function filterInstalledModels<T extends { model?: string; localModelId?: string; capabilities?: string[]; engine?: string }>(
  models: T[],
  query: string,
): T[] {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return models;
  return models.filter((model) => {
    const modelName = (model.model || '').toLowerCase();
    const localId = (model.localModelId || '').toLowerCase();
    const caps = (model.capabilities || []).join(' ').toLowerCase();
    const eng = (model.engine || '').toLowerCase();
    return modelName.includes(normalized) || localId.includes(normalized) || caps.includes(normalized) || eng.includes(normalized);
  });
}
