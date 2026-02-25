import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiCatalogItemDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiInstallPlanDescriptor,
  type LocalAiDownloadProgressEvent,
  type LocalAiInstallPayload,
  type LocalAiVerifiedModelDescriptor,
} from '@runtime/local-ai-runtime';
import type { RuntimeDependencyTargetDescriptor } from '../../runtime-config-panel-types';
import type { RuntimeConfigStateV11, RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/state/v11/types';
import { Button, Card, Input, StatusBadge, renderModelChips } from '../primitives';

type LocalRuntimeModelCenterProps = {
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

const CAPABILITY_OPTIONS = ['chat', 'image', 'video', 'tts', 'stt', 'embedding'] as const;
type CapabilityOption = typeof CAPABILITY_OPTIONS[number];
type ProgressSessionState = {
  event: LocalAiDownloadProgressEvent;
  updatedAtMs: number;
};

const PROGRESS_SESSION_LIMIT = 6;
const PROGRESS_RETENTION_MS = 15 * 60 * 1000;
const HIGHLIGHT_CLEAR_MS = 8000;

function statusLabel(value: string): 'healthy' | 'degraded' | 'idle' | 'unreachable' {
  if (value === 'active') return 'healthy';
  if (value === 'unhealthy') return 'degraded';
  if (value === 'installed') return 'idle';
  return 'unreachable';
}

function formatBytes(value: number | undefined): string {
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

function formatSpeed(value: number | undefined): string {
  const safe = Number(value);
  if (!Number.isFinite(safe) || safe <= 0) return '-';
  return `${formatBytes(safe)}/s`;
}

function formatEta(seconds: number | undefined): string {
  const safe = Number(seconds);
  if (!Number.isFinite(safe) || safe < 0) return '-';
  if (safe < 60) return `${Math.ceil(safe)}s`;
  const minutes = Math.floor(safe / 60);
  const remain = Math.ceil(safe % 60);
  return `${minutes}m ${remain}s`;
}

function parseTimestamp(value: string | undefined): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function pruneProgressSessions(
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

export function LocalRuntimeModelCenter(props: LocalRuntimeModelCenterProps) {
  const [installing, setInstalling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyByModelId, setBusyByModelId] = useState<Record<string, boolean>>({});
  const [modelId, setModelId] = useState('');
  const [repo, setRepo] = useState('');
  const [revision, setRevision] = useState('main');
  const [engine, setEngine] = useState('localai');
  const [entry, setEntry] = useState('');
  const [license, setLicense] = useState('');
  const [selectedCapabilities, setSelectedCapabilities] = useState<CapabilityOption[]>(['chat']);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingHighlightModel, setPendingHighlightModel] = useState('');
  const [highlightLocalModelId, setHighlightLocalModelId] = useState('');
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>({});
  const [verifiedModels, setVerifiedModels] = useState<LocalAiVerifiedModelDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [verifiedModelQuery, setVerifiedModelQuery] = useState('');
  const [installingVerifiedTemplateId, setInstallingVerifiedTemplateId] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<LocalAiCatalogItemDescriptor[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [planPreview, setPlanPreview] = useState<LocalAiInstallPlanDescriptor | null>(null);
  const [loadingPlanPreview, setLoadingPlanPreview] = useState(false);
  const [installingCatalogItemId, setInstallingCatalogItemId] = useState('');
  const [internalSelectedDependencyModId, setInternalSelectedDependencyModId] = useState('');
  const [selectedDependencyCapability, setSelectedDependencyCapability] = useState<'auto' | CapabilityOption>('auto');
  const [dependencyPlanPreview, setDependencyPlanPreview] = useState<LocalAiDependencyResolutionPlan | null>(null);
  const [loadingDependencyPlan, setLoadingDependencyPlan] = useState(false);
  const [applyingDependencies, setApplyingDependencies] = useState(false);
  const [dependencyApplySummary, setDependencyApplySummary] = useState('');
  const displayMode: 'runtime' | 'mod' = props.displayMode === 'mod' ? 'mod' : 'runtime';
  const isModMode = displayMode === 'mod';
  const lockedDependencyModId = String(props.lockedDependencyModId || '').trim();
  const dependencySelectionLocked = isModMode && Boolean(lockedDependencyModId);
  const selectedDependencyModId = useMemo(
    () => (
      lockedDependencyModId
      || String(props.selectedDependencyModId || '').trim()
      || internalSelectedDependencyModId
    ),
    [internalSelectedDependencyModId, lockedDependencyModId, props.selectedDependencyModId],
  );
  const setSelectedDependencyModId = useCallback((modId: string) => {
    const normalized = String(modId || '').trim();
    if (dependencySelectionLocked) return;
    setInternalSelectedDependencyModId(normalized);
    props.onSelectDependencyModId?.(normalized);
  }, [dependencySelectionLocked, props.onSelectDependencyModId]);

  const refreshVerifiedModels = useCallback(async () => {
    setLoadingVerifiedModels(true);
    try {
      const rows = await localAiRuntime.listVerified();
      setVerifiedModels(rows);
    } catch {
      setVerifiedModels([]);
    } finally {
      setLoadingVerifiedModels(false);
    }
  }, []);

  const refreshCatalogItems = useCallback(async (input?: {
    query?: string;
    capability?: 'all' | CapabilityOption;
  }) => {
    const query = String(input?.query ?? catalogQuery).trim();
    const capability = input?.capability ?? catalogCapability;
    setLoadingCatalog(true);
    try {
      const rows = await localAiRuntime.searchCatalog({
        query: query || undefined,
        capability: capability === 'all' ? undefined : capability,
        limit: 30,
      });
      setCatalogItems(rows);
      if (rows.length === 0) {
        setSelectedCatalogItemId('');
        setPlanPreview(null);
      } else if (!rows.some((item) => item.itemId === selectedCatalogItemId)) {
        setSelectedCatalogItemId(rows[0]?.itemId || '');
      }
    } catch {
      setCatalogItems([]);
      setSelectedCatalogItemId('');
      setPlanPreview(null);
    } finally {
      setLoadingCatalog(false);
    }
  }, [catalogCapability, catalogQuery, selectedCatalogItemId]);

  const resolveDependencyPlanPreview = useCallback(async (input?: {
    modId?: string;
    capability?: 'auto' | CapabilityOption;
  }) => {
    const modId = String(input?.modId ?? selectedDependencyModId).trim();
    const capability = input?.capability ?? selectedDependencyCapability;
    if (!modId) {
      setDependencyPlanPreview(null);
      return;
    }
    setLoadingDependencyPlan(true);
    try {
      const plan = await props.onResolveDependencies(
        modId,
        capability === 'auto' ? undefined : capability,
      );
      setDependencyPlanPreview(plan);
    } catch {
      setDependencyPlanPreview(null);
    } finally {
      setLoadingDependencyPlan(false);
    }
  }, [props.onResolveDependencies, selectedDependencyCapability, selectedDependencyModId]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void localAiRuntime.subscribeDownloadProgress((event) => {
      if (disposed) return;
      const nowMs = Date.now();
      setProgressBySessionId((prev) => {
        const next = pruneProgressSessions(prev, nowMs);
        return {
          ...next,
          [event.installSessionId]: {
            event,
            updatedAtMs: nowMs,
          },
        };
      });
    }).then((off) => {
      if (disposed) {
        off();
        return;
      }
      unsubscribe = off;
    });
    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isModMode]);

  useEffect(() => {
    if (isModMode) {
      return;
    }
    void refreshVerifiedModels();
  }, [isModMode, refreshVerifiedModels]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    const timer = setTimeout(() => {
      void refreshCatalogItems();
    }, 180);
    return () => {
      clearTimeout(timer);
    };
  }, [catalogCapability, catalogQuery, isModMode, refreshCatalogItems]);

  useEffect(() => {
    if (props.runtimeDependencyTargets.length === 0) {
      setSelectedDependencyModId('');
      setDependencyPlanPreview(null);
      return;
    }
    if (!props.runtimeDependencyTargets.some((item) => item.modId === selectedDependencyModId)) {
      setSelectedDependencyModId(props.runtimeDependencyTargets[0]?.modId || '');
    }
  }, [props.runtimeDependencyTargets, selectedDependencyModId, setSelectedDependencyModId]);

  useEffect(() => {
    if (!selectedDependencyModId) {
      setDependencyPlanPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void resolveDependencyPlanPreview();
    }, 140);
    return () => {
      clearTimeout(timer);
    };
  }, [resolveDependencyPlanPreview, selectedDependencyCapability, selectedDependencyModId]);

  useEffect(() => {
    if (isModMode) {
      setPlanPreview(null);
      return;
    }
    if (!selectedCatalogItemId) {
      setPlanPreview(null);
      return;
    }
    const selected = catalogItems.find((item) => item.itemId === selectedCatalogItemId) || null;
    if (!selected) {
      setPlanPreview(null);
      return;
    }

    let disposed = false;
    void (async () => {
      setLoadingPlanPreview(true);
      try {
        const plan = await localAiRuntime.resolveInstallPlan({
          itemId: selected.itemId,
          source: selected.source,
          templateId: selected.templateId,
          modelId: selected.modelId,
          repo: selected.repo,
          revision: selected.revision,
        });
        if (!disposed) {
          setPlanPreview(plan);
        }
      } catch {
        if (!disposed) {
          setPlanPreview(null);
        }
      } finally {
        if (!disposed) {
          setLoadingPlanPreview(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [catalogItems, isModMode, selectedCatalogItemId]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    const timer = setInterval(() => {
      const nowMs = Date.now();
      setProgressBySessionId((prev) => pruneProgressSessions(prev, nowMs));
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [isModMode]);

  useEffect(() => {
    if (isModMode) {
      return;
    }
    if (!pendingHighlightModel) return;
    const targetModel = pendingHighlightModel.toLowerCase();
    const matched = props.state.localRuntime.models.find((model) => {
      const modelName = String(model.model || '').trim().toLowerCase();
      const localModelId = String(model.localModelId || '').trim().toLowerCase();
      return modelName === targetModel || localModelId.includes(targetModel);
    });
    if (!matched) return;
    setHighlightLocalModelId(matched.localModelId);
    setPendingHighlightModel('');
  }, [isModMode, pendingHighlightModel, props.state.localRuntime.models]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    if (!highlightLocalModelId) return;
    const timer = setTimeout(() => {
      setHighlightLocalModelId('');
    }, HIGHLIGHT_CLEAR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [highlightLocalModelId, isModMode]);

  const sortedModels = useMemo(
    () => [...props.state.localRuntime.models].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return String(right.localModelId || '').localeCompare(String(left.localModelId || ''));
    }),
    [props.state.localRuntime.models],
  );

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((item) => item.itemId === selectedCatalogItemId) || null,
    [catalogItems, selectedCatalogItemId],
  );

  const selectedDependencyTarget = useMemo(
    () => props.runtimeDependencyTargets.find((item) => item.modId === selectedDependencyModId) || null,
    [props.runtimeDependencyTargets, selectedDependencyModId],
  );

  const progressEvents = useMemo(
    () => Object.values(progressBySessionId)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, PROGRESS_SESSION_LIMIT)
      .map((item) => item.event),
    [progressBySessionId],
  );

  const activeFormModelProgress = useMemo(() => {
    const key = String(modelId || '').trim();
    if (!key) return null;
    return progressEvents.find((event) => event.modelId === key) || null;
  }, [modelId, progressEvents]);

  const filteredVerifiedModels = useMemo(() => {
    const query = String(verifiedModelQuery || '').trim().toLowerCase();
    if (!query) return verifiedModels;
    return verifiedModels.filter((item) => {
      const modelId = String(item.modelId || '').toLowerCase();
      const title = String(item.title || '').toLowerCase();
      const description = String(item.description || '').toLowerCase();
      const tags = (item.tags || []).join(' ').toLowerCase();
      return modelId.includes(query)
        || title.includes(query)
        || description.includes(query)
        || tags.includes(query);
    });
  }, [verifiedModelQuery, verifiedModels]);

  const runWithModelBusy = async (localModelId: string, task: () => Promise<void>) => {
    setBusyByModelId((prev) => ({ ...prev, [localModelId]: true }));
    try {
      await task();
    } finally {
      setBusyByModelId((prev) => ({ ...prev, [localModelId]: false }));
    }
  };

  const toggleCapability = (capability: CapabilityOption) => {
    setSelectedCapabilities((prev) => {
      if (prev.includes(capability)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== capability);
      }
      return [...prev, capability];
    });
  };

  const currentCapabilities = selectedCapabilities.length > 0 ? selectedCapabilities : ['chat'];
  const dependencySection = (
    <div className="space-y-3 rounded-[10px] border border-sky-100 bg-sky-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-sky-900">
          {isModMode ? 'Model Dependencies (Resolve + Apply)' : 'Mod Dependencies (Resolve + Apply)'}
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={loadingDependencyPlan || !selectedDependencyModId}
          onClick={() => void resolveDependencyPlanPreview()}
        >
          {loadingDependencyPlan ? 'Resolving...' : 'Resolve Plan'}
        </Button>
      </div>
      {props.runtimeDependencyTargets.length <= 0 ? (
        <p className="text-[11px] text-sky-800">No dependency-enabled runtime mod found.</p>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-2 ${dependencySelectionLocked ? '' : 'md:grid-cols-2'}`}>
            {dependencySelectionLocked ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-sky-900">Runtime Mod</label>
                <div className="h-[46px] w-full rounded-[10px] border border-sky-200 bg-white px-3 text-sm text-sky-900 flex items-center">
                  {selectedDependencyTarget?.modName || selectedDependencyModId || 'Unknown runtime mod'}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-sky-900">Runtime Mod</label>
                <select
                  value={selectedDependencyModId}
                  onChange={(event) => setSelectedDependencyModId(event.target.value)}
                  className="h-[46px] w-full rounded-[10px] border border-sky-200 bg-white px-3 text-sm text-sky-900 outline-none"
                >
                  {props.runtimeDependencyTargets.map((target) => (
                    <option key={`runtime-dep-${target.modId}`} value={target.modId}>{target.modName}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-sky-900">Capability</label>
              <select
                value={selectedDependencyCapability}
                onChange={(event) => setSelectedDependencyCapability((event.target.value || 'auto') as 'auto' | CapabilityOption)}
                className="h-[46px] w-full rounded-[10px] border border-sky-200 bg-white px-3 text-sm text-sky-900 outline-none"
              >
                <option value="auto">auto</option>
                {CAPABILITY_OPTIONS.map((capability) => (
                  <option key={`runtime-dep-capability-${capability}`} value={capability}>{capability}</option>
                ))}
              </select>
            </div>
          </div>
          {selectedDependencyTarget ? (
            <p className="text-[11px] text-sky-800">
              consume={selectedDependencyTarget.consumeCapabilities.join(', ') || 'chat'}
            </p>
          ) : null}
          {dependencySelectionLocked && !selectedDependencyTarget ? (
            <p className="text-[11px] text-amber-700">Selected mod has no dependency declaration.</p>
          ) : null}
          {loadingDependencyPlan ? (
            <p className="text-[11px] text-sky-800">Resolving dependency plan...</p>
          ) : dependencyPlanPreview ? (
            <div className="space-y-2 rounded-md border border-sky-200 bg-white p-2">
              <p className="text-[11px] text-sky-900">
                planId={dependencyPlanPreview.planId} · dependencies={dependencyPlanPreview.dependencies.length}
              </p>
              <p className="text-[11px] text-sky-800">
                selected={dependencyPlanPreview.dependencies.filter((item) => item.selected).length}
                {' · '}
                required={dependencyPlanPreview.dependencies.filter((item) => item.required).length}
              </p>
              {dependencyPlanPreview.warnings.length > 0 ? (
                <p className="text-[11px] text-amber-700">{dependencyPlanPreview.warnings.join(' ; ')}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={applyingDependencies || !selectedDependencyModId}
                  onClick={() => {
                    if (!selectedDependencyModId) return;
                    void (async () => {
                      setApplyingDependencies(true);
                      setDependencyApplySummary('');
                      try {
                        await props.onApplyDependencies(
                          selectedDependencyModId,
                          selectedDependencyCapability === 'auto' ? undefined : selectedDependencyCapability,
                        );
                        setDependencyApplySummary('Dependency apply completed.');
                      } catch (error) {
                        setDependencyApplySummary(
                          `Dependency apply failed: ${error instanceof Error ? error.message : String(error || '')}`,
                        );
                      } finally {
                        setApplyingDependencies(false);
                        void resolveDependencyPlanPreview();
                      }
                    })();
                  }}
                >
                  {applyingDependencies ? 'Applying...' : 'Apply Dependencies'}
                </Button>
                {dependencyApplySummary ? (
                  <p className="text-[11px] text-sky-800">{dependencyApplySummary}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-sky-800">No dependency plan available for selected mod.</p>
          )}
        </>
      )}
    </div>
  );

  if (isModMode) {
    const modCapabilities = selectedDependencyTarget?.consumeCapabilities || [];
    const capabilityStatuses = modCapabilities.map((cap) => {
      const localNode = props.state.localRuntime.nodeMatrix.find(
        (node) => node.capability === cap && node.available,
      );
      const hasLocalModel = props.state.localRuntime.models.some(
        (model) => model.status === 'active' && model.capabilities.includes(cap),
      );
      const localAvailable = Boolean(localNode) || hasLocalModel;
      return { capability: cap, localAvailable };
    });
    const hasUnavailable = capabilityStatuses.some((item) => !item.localAvailable);
    return (
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">
              {selectedDependencyTarget?.modName || selectedDependencyModId || 'Runtime Mod'}
            </h4>
            <p className="text-xs text-gray-500">Configure only this mod&apos;s declared model dependencies.</p>
          </div>
          {modCapabilities.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700">AI Capability Status</p>
              <div className="flex flex-wrap gap-2">
                {capabilityStatuses.map((item) => (
                  <span
                    key={`mod-cap-status-${item.capability}`}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                      item.localAvailable
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {item.capability}: {item.localAvailable ? 'local-runtime' : 'needs setup'}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {dependencySection}
        </Card>
        {hasUnavailable ? (
          <Card className="space-y-2 border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold text-amber-900">Setup Required</p>
            <p className="text-[11px] text-amber-800">
              Some capabilities are not available locally. Install a local model or configure a cloud API connector to enable them.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => props.onNavigateToSetup?.('models')}>
                Install Models
              </Button>
              <Button variant="ghost" size="sm" onClick={() => props.onNavigateToSetup?.('cloud-api')}>
                Configure Cloud API
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Search & Install Models</h4>
          <p className="text-xs text-gray-500">Search the catalog or pick a verified model to install.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={props.state.localRuntime.status} />
          <Button variant="secondary" size="sm" disabled={props.checkingHealth} onClick={() => void props.onHealthCheck()}>
            {props.checkingHealth ? 'Checking...' : 'Health'}
          </Button>
          <Button variant="secondary" size="sm" disabled={props.discovering} onClick={() => void props.onDiscover()}>
            {props.discovering ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-[10px] border border-indigo-100 bg-indigo-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-indigo-900">Search Models (Verified + Hugging Face)</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingCatalog}
            onClick={() => void refreshCatalogItems()}
          >
            {loadingCatalog ? 'Searching...' : 'Search'}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr,1fr]">
          <Input
            label="Catalog Query"
            value={catalogQuery}
            onChange={setCatalogQuery}
            placeholder="Search repo/model/task..."
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-indigo-900">Capability</label>
            <select
              value={catalogCapability}
              onChange={(event) => setCatalogCapability((event.target.value || 'all') as 'all' | CapabilityOption)}
              className="h-[46px] w-full rounded-[10px] border border-indigo-200 bg-white px-3 text-sm text-indigo-900 outline-none"
            >
              <option value="all">all</option>
              {CAPABILITY_OPTIONS.map((capability) => (
                <option key={`catalog-capability-${capability}`} value={capability}>{capability}</option>
              ))}
            </select>
          </div>
        </div>
        {catalogItems.length === 0 ? (
          <p className="text-[11px] text-indigo-800">
            {loadingCatalog ? 'Searching catalog...' : 'No catalog model matched your query.'}
          </p>
        ) : (
          <div className="space-y-2">
            {catalogItems.map((item) => {
              const selected = selectedCatalogItemId === item.itemId;
              return (
                <button
                  key={`catalog-item-${item.itemId}`}
                  type="button"
                  onClick={() => setSelectedCatalogItemId(item.itemId)}
                  className={`w-full rounded-md border p-2 text-left ${
                    selected
                      ? 'border-indigo-300 bg-white'
                      : 'border-indigo-100 bg-indigo-50/40 hover:bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-indigo-900">{item.title || item.modelId}</p>
                      <p className="text-[11px] text-indigo-800">{item.modelId}</p>
                      <p className="text-[11px] text-indigo-700">
                        {item.source === 'verified' ? 'Verified' : 'HF'} · {item.engine} · {(item.capabilities || []).join(', ') || 'chat'}
                      </p>
                    </div>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.installAvailable
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                    >
                      {item.installAvailable ? 'Installable' : 'Needs Manual'}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-[11px] text-indigo-700">{item.description}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedCatalogItem ? (
        <div className="space-y-2 rounded-[10px] border border-indigo-100 bg-white p-3">
          <p className="text-xs font-semibold text-indigo-900">Install Plan Confirmation</p>
          {loadingPlanPreview ? (
            <p className="text-[11px] text-indigo-700">Resolving install plan...</p>
          ) : !planPreview ? (
            <p className="text-[11px] text-amber-700">Install plan unavailable. Try another model or use Advanced install.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-indigo-700">
                {planPreview.modelId} · {planPreview.engine} · {planPreview.engineRuntimeMode}
              </p>
              <p className="text-[11px] text-indigo-700">
                files={planPreview.files.length} · endpoint={planPreview.endpoint}
              </p>
              {planPreview.warnings.length > 0 ? (
                <p className="text-[11px] text-amber-700">{planPreview.warnings.join(' ; ')}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!planPreview.installAvailable || Boolean(installingCatalogItemId)}
                  onClick={() => {
                    if (!selectedCatalogItem) return;
                    void (async () => {
                      setInstallingCatalogItemId(selectedCatalogItem.itemId);
                      try {
                        await props.onInstallCatalogItem(selectedCatalogItem);
                        setPendingHighlightModel(selectedCatalogItem.modelId);
                      } finally {
                        setInstallingCatalogItemId('');
                      }
                    })();
                  }}
                >
                  {installingCatalogItemId === selectedCatalogItem.itemId ? 'Installing...' : 'Install from Catalog'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="space-y-2 rounded-[10px] border border-emerald-100 bg-emerald-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-emerald-900">Verified Quick Picks</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingVerifiedModels}
            onClick={() => void refreshVerifiedModels()}
          >
            {loadingVerifiedModels ? 'Refreshing...' : 'Refresh Verified'}
          </Button>
        </div>
        <Input
          label="Search Verified Models"
          value={verifiedModelQuery}
          onChange={setVerifiedModelQuery}
          placeholder="Search by title/model/tag..."
        />
        {filteredVerifiedModels.length === 0 ? (
          <p className="text-[11px] text-emerald-800">
            {loadingVerifiedModels ? 'Loading verified models...' : 'No verified model matched your query.'}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredVerifiedModels.map((item) => {
              const installing = installingVerifiedTemplateId === item.templateId;
              return (
                <div key={`verified-model-${item.templateId}`} className="rounded-md border border-emerald-200 bg-white p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-emerald-900">{item.title}</p>
                      <p className="text-[11px] text-emerald-700">{item.modelId}</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={installing || Boolean(installingVerifiedTemplateId)}
                      onClick={() => {
                        void (async () => {
                          setInstallingVerifiedTemplateId(item.templateId);
                          try {
                            await props.onInstallVerified(item.templateId);
                            setPendingHighlightModel(item.modelId);
                          } finally {
                            setInstallingVerifiedTemplateId('');
                          }
                        })();
                      }}
                    >
                      {installing ? 'Installing...' : 'One-Click Install'}
                    </Button>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-[11px] text-emerald-700">{item.description}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </Card>

      {activeFormModelProgress ? (
        <div className="space-y-2 rounded-[10px] border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">
              Install Progress · {activeFormModelProgress.modelId} ({activeFormModelProgress.phase})
            </p>
            <p className={`text-[11px] ${activeFormModelProgress.done ? (activeFormModelProgress.success ? 'text-emerald-700' : 'text-rose-700') : 'text-gray-500'}`}>
              {activeFormModelProgress.done
                ? (activeFormModelProgress.success ? 'Completed' : 'Failed')
                : 'Running'}
            </p>
          </div>
          {typeof activeFormModelProgress.bytesTotal === 'number' && activeFormModelProgress.bytesTotal > 0 ? (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full ${activeFormModelProgress.done && !activeFormModelProgress.success ? 'bg-rose-500' : 'bg-blue-500'}`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, Math.round((activeFormModelProgress.bytesReceived / activeFormModelProgress.bytesTotal) * 100)),
                    )}%`,
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                <span>{formatBytes(activeFormModelProgress.bytesReceived)} / {formatBytes(activeFormModelProgress.bytesTotal)}</span>
                <span>{formatSpeed(activeFormModelProgress.speedBytesPerSec)}</span>
                <span>ETA {formatEta(activeFormModelProgress.etaSeconds)}</span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-600">{formatBytes(activeFormModelProgress.bytesReceived)} downloaded</p>
          )}
          {activeFormModelProgress.message ? (
            <p className={`text-[11px] ${activeFormModelProgress.done && !activeFormModelProgress.success ? 'text-rose-700' : 'text-gray-500'}`}>
              {activeFormModelProgress.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {progressEvents.length > 0 ? (
        <div className="space-y-1 rounded-[10px] border border-gray-200 bg-white p-3">
          <p className="text-xs font-semibold text-gray-700">Recent Install Sessions</p>
          <div className="space-y-1">
            {progressEvents.map((event) => (
              <p key={`install-session-${event.installSessionId}`} className="text-[11px] text-gray-500">
                {event.modelId} · {event.phase} · {event.done ? (event.success ? 'done' : 'failed') : 'running'}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <Card className="space-y-3 p-5">
        <p className="text-sm font-semibold text-gray-900">Installed Models</p>
        {sortedModels.length === 0 ? (
          <p className="text-xs text-amber-700">No local model registered. Install or import one to enable Local Runtime capability resolution.</p>
        ) : (
          sortedModels.map((model) => {
            const busy = Boolean(busyByModelId[model.localModelId]);
            const status = statusLabel(model.status);
            return (
              <div
                key={`local-runtime-model-${model.localModelId}`}
                className={`rounded-[10px] border bg-gray-50 p-3 ${
                  highlightLocalModelId === model.localModelId
                    ? 'border-emerald-300 ring-1 ring-emerald-200'
                    : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{model.model}</p>
                    <p className="truncate text-[11px] text-gray-500">{model.localModelId} · {model.engine}</p>
                    {highlightLocalModelId === model.localModelId ? (
                      <p className="mt-1 text-[11px] font-medium text-emerald-700">
                        Newly installed model is ready for capability selection.
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-gray-600">
                      {(model.capabilities || []).join(', ') || 'chat'}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Installed: {model.installedAt || '-'}
                    </p>
                  </div>
                  <StatusBadge status={status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || model.status === 'active'}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onStart(model.localModelId);
                      });
                    }}
                  >
                    Start
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || model.status !== 'active'}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onStop(model.localModelId);
                      });
                    }}
                  >
                    Stop
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onRestart(model.localModelId);
                      });
                    }}
                  >
                    Restart
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void runWithModelBusy(model.localModelId, async () => {
                        await props.onRemove(model.localModelId);
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card className="p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          <p className="text-sm font-semibold text-gray-900">Advanced</p>
          <p className="text-xs text-gray-500">{advancedOpen ? 'Hide' : 'Show'}</p>
        </button>
        {advancedOpen ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Model ID" value={modelId} onChange={setModelId} placeholder="qwen2.5-7b-instruct" />
              <Input label="HF Repo" value={repo} onChange={setRepo} placeholder="org/model" />
              <Input label="Revision" value={revision} onChange={setRevision} placeholder="main" />
              <Input label="Engine" value={engine} onChange={setEngine} placeholder="localai" />
              <Input label="Entry (optional)" value={entry} onChange={setEntry} placeholder="model.gguf" />
              <Input label="License (optional)" value={license} onChange={setLicense} placeholder="apache-2.0" />
            </div>
            <div className="space-y-2 rounded-[10px] border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700">Capabilities</p>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_OPTIONS.map((capability) => (
                  <label
                    key={`capability-${capability}`}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={currentCapabilities.includes(capability)}
                      onChange={() => toggleCapability(capability)}
                      className="h-3.5 w-3.5"
                    />
                    <span>{capability}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">Choose at least one capability. Install is blocked when none is selected.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={installing || !modelId.trim() || !repo.trim() || currentCapabilities.length === 0}
                onClick={() => {
                  void (async () => {
                    setInstalling(true);
                    try {
                      const installedModel = modelId.trim();
                      await props.onInstall({
                        modelId: installedModel,
                        repo: repo.trim(),
                        revision: revision.trim() || undefined,
                        engine: engine.trim() || undefined,
                        entry: entry.trim() || undefined,
                        license: license.trim() || undefined,
                        capabilities: currentCapabilities,
                      });
                      setPendingHighlightModel(installedModel);
                    } finally {
                      setInstalling(false);
                    }
                  })();
                }}
              >
                {installing ? 'Installing...' : 'Install from Hugging Face'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={importing}
                onClick={() => {
                  void (async () => {
                    setImporting(true);
                    try {
                      await props.onImport();
                    } finally {
                      setImporting(false);
                    }
                  })();
                }}
              >
                {importing ? 'Importing...' : 'Import from Local Manifest'}
              </Button>
            </div>
            <Input
              label="Local Runtime Endpoint"
              value={props.state.localRuntime.endpoint}
              onChange={props.onChangeLocalRuntimeEndpoint}
              placeholder="http://127.0.0.1:1234/v1"
            />
            <Input
              label="Search Discovered Models"
              value={props.localRuntimeModelQuery}
              onChange={props.onSetLocalRuntimeModelQuery}
              placeholder="Search by model name..."
            />
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Discovered Models</p>
              {renderModelChips(props.filteredLocalRuntimeModels, 'local-runtime-v11-advanced')}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
