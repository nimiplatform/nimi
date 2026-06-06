import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalTransferSessionSummary,
  NimiRuntimeLocalDownloadState,
  NimiRuntimeLocalTransferProgressEvent,
  NimiRuntimeLocalInstallPayload,
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeLocalProfileDescriptor,
  NimiRuntimeLocalProfileEntryDescriptor,
  NimiRuntimeLocalProfileApplyResult,
  NimiRuntimeLocalProfileResolutionPlan,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  NIMI_RUNTIME_LOCAL_ENGINE_IDS,
  NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS,
  normalizeNimiRuntimeLocalRunnableAssetKindId,
  type NimiRuntimeLocalEngineId,
  type NimiRuntimeLocalRunnableAssetKindId,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import type { RuntimeConfigStateV11, RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

export type LocalModelCenterProps = {
  state: RuntimeConfigStateV11;
  discovering: boolean;
  checkingHealth: boolean;
  displayMode?: 'runtime' | 'profile-target';
  lockedProfileTargetId?: string;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  selectedProfileTargetId?: string;
  onSelectProfileTargetId?: (targetId: string) => void;
  localModelQuery: string;
  filteredLocalModels: string[];
  onDiscover: () => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onResolveProfile: (targetId: string, profileId: string, capability?: string) => Promise<NimiRuntimeLocalProfileResolutionPlan>;
  onApplyProfile: (targetId: string, profileId: string, capability?: string) => Promise<NimiRuntimeLocalProfileApplyResult>;
  onInstallCatalogItem: (
    item: NimiRuntimeLocalCatalogItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      capabilities?: string[];
      engine?: string;
    },
  ) => Promise<void>;
  onInstall: (payload: NimiRuntimeLocalInstallPayload) => Promise<void>;
  onInstallVerified: (templateId: string) => Promise<void>;
  onImport: () => Promise<void>;
  onInstallVerifiedAsset: (templateId: string) => Promise<void>;
  onImportAsset: () => Promise<void>;
  onScaffoldAssetOrphan: (path: string, kind: NimiRuntimeLocalAssetKind) => Promise<void>;
  onImportFile: (capabilities: string[], engine?: string) => Promise<void>;
  onRemove: (localModelId: string) => Promise<void>;
  onRemoveAsset: (localAssetId: string) => Promise<void>;
  onSetLocalModelQuery: (value: string) => void;
  onNavigateToSetup?: (pageId: RuntimeSetupPageIdV11) => void;
  onDownloadComplete?: (
    installSessionId: string,
    success: boolean,
    message?: string,
    localModelId?: string,
    modelId?: string,
  ) => Promise<void>;
  onRetryInstall?: (plan: NimiRuntimeLocalInstallPlanDescriptor, source: 'catalog' | 'manual' | 'verified') => void;
  installSessionMeta?: Map<string, { plan: NimiRuntimeLocalInstallPlanDescriptor; installSource: string }>;
};

export const CAPABILITY_OPTIONS = NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS;
export type CapabilityOption = NimiRuntimeLocalRunnableAssetKindId;
export const ASSET_CLASS_OPTIONS = ['runnable', 'dependency'] as const;
export type AssetClassOption = typeof ASSET_CLASS_OPTIONS[number];
export const ASSET_ENGINE_OPTIONS = NIMI_RUNTIME_LOCAL_ENGINE_IDS;
export type AssetEngineOption = NimiRuntimeLocalEngineId;
export type ProgressSessionState = {
  event: NimiRuntimeLocalTransferProgressEvent;
  updatedAtMs: number;
  createdAtMs: number;
  installSource?: 'catalog' | 'manual' | 'verified';
};

export function isLocalModelLifecycleBusy(
  value: string | undefined,
): boolean {
  return value === 'starting' || value === 'stopping' || value === 'restarting';
}

export function isLocalModelLifecycleVisible(
  value: string | undefined,
): boolean {
  return Boolean(value) && value !== 'idle' && value !== 'error';
}

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

export function downloadStateLabel(state: NimiRuntimeLocalDownloadState): string {
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
  return normalizeNimiRuntimeLocalRunnableAssetKindId(value);
}

export function normalizeAssetClassOption(value: string | undefined): AssetClassOption {
  const normalized = String(value || '').trim().toLowerCase();
  return (ASSET_CLASS_OPTIONS.find((item) => item === normalized) || 'runnable') as AssetClassOption;
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
      return 'Local Speech preflight is blocked on this host.';
    case ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED:
      return 'Explicit download confirmation is required before Local Speech setup can continue.';
    case ReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED:
      return 'Local Speech environment initialization failed.';
    case ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED:
      return 'Local Speech host startup or probe failed.';
    case ReasonCode.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED:
      return 'The required Local Speech capability is missing and must be downloaded.';
    case ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED:
      return 'The Local Speech bundle is degraded and needs repair.';
    default:
      return '';
  }
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

export function defaultAssetDeclaration(assetClass: AssetClassOption = 'runnable'): NimiRuntimeLocalAssetDeclaration {
  if (assetClass === 'dependency') {
    return {
      assetKind: 'vae',
    };
  }
  return {
    assetKind: 'chat',
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
  selectedProfileTargetId: string | undefined,
): RuntimeProfileTargetDescriptor | null {
  const targetId = String(selectedProfileTargetId || '').trim();
  if (!targetId) {
    return null;
  }
  return runtimeProfileTargets.find((target) => target.targetId === targetId) || null;
}

export function resolveProfileCapabilityOptions(
  profile: NimiRuntimeLocalProfileDescriptor | null | undefined,
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
  profile: NimiRuntimeLocalProfileDescriptor | null | undefined,
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
  selectedProfileTargetId: string | undefined,
): boolean {
  const target = resolveSelectedRuntimeProfileTarget(runtimeProfileTargets, selectedProfileTargetId);
  return Boolean(target && target.profiles.length > 0);
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

export function resolveDependencyStatus(
  entry: NimiRuntimeLocalProfileEntryDescriptor,
  state: RuntimeConfigStateV11,
): { met: boolean; reason: string } {
  if (entry.capability) {
    const localNode = state.local.nodeMatrix.find(
      (node) => node.capability === entry.capability && node.available,
    );
    const cap = entry.capability;
    const hasLocalModel = state.local.models.some(
      (m) => m.status === 'active' && (m.capabilities as string[]).includes(cap!),
    );
    if (localNode || hasLocalModel) {
      return { met: true, reason: 'available locally' };
    }
    return { met: false, reason: `${entry.capability} not available` };
  }
  return { met: true, reason: '' };
}
