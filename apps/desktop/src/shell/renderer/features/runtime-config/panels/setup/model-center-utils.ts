import type {
  LocalAiCatalogItemDescriptor,
  LocalAiDependencyResolutionPlan,
  LocalAiDownloadProgressEvent,
  LocalAiInstallPayload,
} from '@runtime/local-ai-runtime';
import type { RuntimeDependencyTargetDescriptor } from '../../runtime-config-panel-types';
import type { RuntimeConfigStateV11, RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/state/types';

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
  onInstallCatalogItem: (item: LocalAiCatalogItemDescriptor) => Promise<void>;
  onInstall: (payload: LocalAiInstallPayload) => Promise<void>;
  onInstallVerified: (templateId: string) => Promise<void>;
  onImport: () => Promise<void>;
  onStart: (localModelId: string) => Promise<void>;
  onStop: (localModelId: string) => Promise<void>;
  onRestart: (localModelId: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
  onSetLocalRuntimeModelQuery: (value: string) => void;
  onChangeLocalRuntimeEndpoint: (endpoint: string) => void;
  onNavigateToSetup?: (pageId: RuntimeSetupPageIdV11) => void;
};

export const CAPABILITY_OPTIONS = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
export type CapabilityOption = typeof CAPABILITY_OPTIONS[number];
export type ProgressSessionState = {
  event: LocalAiDownloadProgressEvent;
  updatedAtMs: number;
};

export const PROGRESS_SESSION_LIMIT = 6;
export const PROGRESS_RETENTION_MS = 15 * 60 * 1000;
export const HIGHLIGHT_CLEAR_MS = 8000;

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
  return `${next.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
