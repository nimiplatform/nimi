import type {
  LocalRuntimeAssetClass,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeArtifactKind,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeDownloadState,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeModelLifecycleOperation,
  LocalRuntimeModelType,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileResolutionPlan,
} from '@runtime/local-runtime';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import type { RuntimeConfigStateV11, RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

export type LocalModelCenterProps = {
  state: RuntimeConfigStateV11;
  discovering: boolean;
  checkingHealth: boolean;
  displayMode?: 'runtime' | 'mod';
  lockedProfileModId?: string;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  selectedProfileModId?: string;
  onSelectProfileModId?: (modId: string) => void;
  localModelQuery: string;
  filteredLocalModels: string[];
  onDiscover: () => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onResolveProfile: (modId: string, profileId: string, capability?: string) => Promise<LocalRuntimeProfileResolutionPlan>;
  onApplyProfile: (modId: string, profileId: string, capability?: string) => Promise<LocalRuntimeProfileApplyResult>;
  onInstallCatalogItem: (
    item: LocalRuntimeCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  onInstall: (payload: LocalRuntimeInstallPayload) => Promise<void>;
  onInstallVerified: (templateId: string) => Promise<void>;
  onImport: () => Promise<void>;
  onInstallVerifiedArtifact: (templateId: string) => Promise<void>;
  onImportArtifact: () => Promise<void>;
  onScaffoldArtifactOrphan: (path: string, kind: LocalRuntimeArtifactKind) => Promise<void>;
  onImportFile: (capabilities: string[], engine?: string) => Promise<void>;
  onStart: (localModelId: string) => Promise<void>;
  onStop: (localModelId: string) => Promise<void>;
  onRestart: (localModelId: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
  onRemoveArtifact: (localArtifactId: string) => Promise<void>;
  onSetLocalModelQuery: (value: string) => void;
  onChangeLocalEndpoint: (endpoint: string) => void;
  onNavigateToSetup?: (pageId: RuntimeSetupPageIdV11) => void;
  onDownloadComplete?: (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => Promise<void>;
  onRetryInstall?: (plan: LocalRuntimeInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => void;
  installSessionMeta?: Map<string, { plan: LocalRuntimeInstallPlanDescriptor; installSource: string }>;
  localModelLifecycleById?: Record<string, LocalRuntimeModelLifecycleOperation>;
  localModelLifecycleErrorById?: Record<string, string>;
};

export const CAPABILITY_OPTIONS = ['chat', 'image', 'video', 'tts', 'stt', 'embedding', 'music'] as const;
export type CapabilityOption = typeof CAPABILITY_OPTIONS[number];
export const INSTALL_ENGINE_OPTIONS = ['llama', 'media', 'speech', 'sidecar'] as const;
export type InstallEngineOption = typeof INSTALL_ENGINE_OPTIONS[number];
export const ASSET_CLASS_OPTIONS = ['model', 'artifact'] as const satisfies readonly LocalRuntimeAssetClass[];
export type AssetClassOption = typeof ASSET_CLASS_OPTIONS[number];
export const MODEL_TYPE_OPTIONS = ['chat', 'embedding', 'image', 'video', 'tts', 'stt', 'music'] as const satisfies readonly LocalRuntimeModelType[];
export type ModelTypeOption = typeof MODEL_TYPE_OPTIONS[number];
export const ASSET_ENGINE_OPTIONS = INSTALL_ENGINE_OPTIONS;
export type AssetEngineOption = InstallEngineOption;
export type ProgressSessionState = {
  event: LocalRuntimeDownloadProgressEvent;
  updatedAtMs: number;
  createdAtMs: number;
  installSource?: 'catalog' | 'manual' | 'verified';
};

export function isLocalModelLifecycleBusy(
  value: LocalRuntimeModelLifecycleOperation | undefined,
): boolean {
  return value === 'starting' || value === 'stopping' || value === 'restarting';
}

export function isLocalModelLifecycleVisible(
  value: LocalRuntimeModelLifecycleOperation | undefined,
): boolean {
  return Boolean(value) && value !== 'idle' && value !== 'error';
}

export const PROGRESS_SESSION_LIMIT = 6;
export const PROGRESS_RETENTION_MS = 15 * 60 * 1000;
export const HIGHLIGHT_CLEAR_MS = 8000;

export function isDownloadTerminal(state: LocalRuntimeDownloadState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function deriveDoneSuccessFromState(state: LocalRuntimeDownloadState): { done: boolean; success: boolean } {
  if (state === 'completed') {
    return { done: true, success: true };
  }
  if (state === 'failed' || state === 'cancelled') {
    return { done: true, success: false };
  }
  return { done: false, success: false };
}

export function toProgressEventFromSummary(
  summary: LocalRuntimeDownloadSessionSummary,
): LocalRuntimeDownloadProgressEvent {
  const terminal = deriveDoneSuccessFromState(summary.state);
  return {
    installSessionId: summary.installSessionId,
    modelId: summary.modelId,
    localModelId: summary.localModelId || undefined,
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

export function downloadStateLabel(state: LocalRuntimeDownloadState): string {
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

export function formatImportPhaseLabel(phase: string | undefined): string {
  const normalized = String(phase || '').trim().toLowerCase();
  if (normalized === 'copy') return 'Copying';
  if (normalized === 'move') return 'Moving';
  if (normalized === 'manifest') return 'Writing manifest';
  if (normalized === 'register' || normalized === 'upsert') return 'Registering';
  return normalized || 'Preparing';
}

export function normalizeCapabilityOption(value: string | undefined): CapabilityOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (CAPABILITY_OPTIONS.find((item) => item === normalized) || 'chat') as CapabilityOption;
}

export function normalizeInstallEngine(value: string | undefined): InstallEngineOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (INSTALL_ENGINE_OPTIONS.find((item) => item === normalized) || 'llama') as InstallEngineOption;
}

export function normalizeAssetClassOption(value: string | undefined): AssetClassOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (ASSET_CLASS_OPTIONS.find((item) => item === normalized) || 'model') as AssetClassOption;
}

export function normalizeModelTypeOption(value: string | undefined): ModelTypeOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (MODEL_TYPE_OPTIONS.find((item) => item === normalized) || 'chat') as ModelTypeOption;
}

export function defaultAssetDeclaration(assetClass: AssetClassOption = 'model'): LocalRuntimeAssetDeclaration {
  if (assetClass === 'artifact') {
    return {
      assetClass,
      artifactKind: 'vae',
      engine: 'media',
    };
  }
  return {
    assetClass,
    modelType: 'chat',
    engine: 'llama',
  };
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

export function resolveSelectedRuntimeProfileTarget(
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[],
  selectedProfileModId: string | undefined,
): RuntimeProfileTargetDescriptor | null {
  const modId = String(selectedProfileModId || '').trim();
  if (!modId) {
    return null;
  }
  return runtimeProfileTargets.find((target) => target.modId === modId) || null;
}

export function resolveProfileCapabilityOptions(
  profile: LocalRuntimeProfileDescriptor | null | undefined,
): string[] {
  if (!profile) {
    return [];
  }
  const consumeCapabilities = Array.isArray(profile.consumeCapabilities)
    ? profile.consumeCapabilities
    : [];
  const entryCapabilities = Array.isArray(profile.entries)
    ? profile.entries.map((entry) => entry.capability)
    : [];
  return Array.from(new Set(
    [...consumeCapabilities, ...entryCapabilities]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

export function normalizeSelectedProfileCapability(
  profile: LocalRuntimeProfileDescriptor | null | undefined,
  selectedCapability: string | undefined,
): string {
  const capabilityOptions = resolveProfileCapabilityOptions(profile);
  if (capabilityOptions.length === 1) {
    return capabilityOptions[0] || '';
  }
  const normalized = String(selectedCapability || '').trim();
  return capabilityOptions.includes(normalized) ? normalized : '';
}

export function shouldShowRuntimeProfileInstallSection(
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[],
  selectedProfileModId: string | undefined,
): boolean {
  const target = resolveSelectedRuntimeProfileTarget(runtimeProfileTargets, selectedProfileModId);
  return Boolean(target && target.profiles.length > 0);
}

function isInteractiveDownloadState(state: LocalRuntimeDownloadState): boolean {
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
