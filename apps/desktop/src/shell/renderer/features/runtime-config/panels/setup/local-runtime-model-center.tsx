import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiVerifiedModelDescriptor,
} from '@runtime/local-ai-runtime';
import { RuntimeSelect } from '../primitives';
import { ModelCenterDependencySection } from './model-center-dependency-section';
import {
  CAPABILITY_OPTIONS,
  downloadStateLabel,
  HIGHLIGHT_CLEAR_MS,
  PROGRESS_SESSION_LIMIT,
  type CapabilityOption,
  type LocalRuntimeModelCenterProps,
  type ProgressSessionState,
  isDownloadTerminal,
  toProgressEventFromSummary,
  formatBytes,
  formatEta,
  formatSpeed,
  parseTimestamp,
  pruneProgressSessions,
} from './model-center-utils';

function formatLastCheckedAgo(lastCheckedAt: string | null): string {
  if (!lastCheckedAt) {
    return 'Not checked yet';
  }
  const ts = parseTimestamp(lastCheckedAt);
  if (!ts) {
    return `Last checked: ${lastCheckedAt}`;
  }
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) {
    return `Checked ${deltaSec} second${deltaSec === 1 ? '' : 's'} ago`;
  }
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) {
    return `Checked ${deltaMin} minute${deltaMin === 1 ? '' : 's'} ago`;
  }
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) {
    return `Checked ${deltaHour} hour${deltaHour === 1 ? '' : 's'} ago`;
  }
  const deltaDay = Math.floor(deltaHour / 24);
  return `Checked ${deltaDay} day${deltaDay === 1 ? '' : 's'} ago`;
}

// Icons
function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function HeartPulseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}

function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function PackageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlayIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function StopIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Toggle Switch
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-mint-500' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Model Icon
function ModelIcon({ engine }: { engine: string }) {
  const colors: Record<string, string> = {
    localai: 'from-emerald-400 to-teal-500',
    ollama: 'from-amber-400 to-orange-500',
    llamacpp: 'from-blue-400 to-indigo-500',
    vllm: 'from-purple-400 to-pink-500',
    default: 'from-gray-400 to-gray-500',
  };
  const color = colors[engine.toLowerCase()] || colors.default;
  
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-white text-[10px] font-bold shadow-sm`}>
      {engine.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function LocalRuntimeModelCenter(props: LocalRuntimeModelCenterProps) {
  const [installing, setInstalling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingHighlightModel, setPendingHighlightModel] = useState('');
  const [highlightLocalModelId, setHighlightLocalModelId] = useState('');
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<LocalAiCatalogItemDescriptor[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [verifiedModels, setVerifiedModels] = useState<LocalAiVerifiedModelDescriptor[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [internalSelectedDependencyModId, setInternalSelectedDependencyModId] = useState('');
  const [selectedDependencyCapability, setSelectedDependencyCapability] = useState<'auto' | CapabilityOption>('auto');
  const [dependencyPlanPreview, setDependencyPlanPreview] = useState<LocalAiDependencyResolutionPlan | null>(null);
  const [loadingDependencyPlan, setLoadingDependencyPlan] = useState(false);

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

  const resolveDependencyPlanPreview = useCallback(async () => {
    const modId = String(selectedDependencyModId || '').trim();
    if (!modId) {
      setDependencyPlanPreview(null);
      return;
    }
    setLoadingDependencyPlan(true);
    try {
      const plan = await props.onResolveDependencies(
        modId,
        selectedDependencyCapability === 'auto' ? undefined : selectedDependencyCapability,
      );
      setDependencyPlanPreview(plan);
    } catch {
      setDependencyPlanPreview(null);
    } finally {
      setLoadingDependencyPlan(false);
    }
  }, [props, selectedDependencyCapability, selectedDependencyModId]);

  // Sorted installed models
  const sortedModels = useMemo(
    () => [...props.state.localRuntime.models].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) return rightRank - leftRank;
      return String(right.localModelId || '').localeCompare(String(left.localModelId || ''));
    }),
    [props.state.localRuntime.models],
  );

  // Filter installed models by search
  const filteredInstalledModels = useMemo(() => {
    if (!searchQuery.trim()) return sortedModels;
    const query = searchQuery.toLowerCase().trim();
    return sortedModels.filter(m => 
      m.model.toLowerCase().includes(query) ||
      m.localModelId.toLowerCase().includes(query) ||
      m.engine.toLowerCase().includes(query)
    );
  }, [sortedModels, searchQuery]);

  // Check if a catalog item is already installed
  const isInstalled = useCallback((modelId: string) => {
    return sortedModels.some(m => m.model.toLowerCase() === modelId.toLowerCase());
  }, [sortedModels]);

  // Catalog search
  const refreshCatalogItems = useCallback(async () => {
    if (!searchQuery.trim()) {
      setCatalogItems([]);
      return;
    }
    setLoadingCatalog(true);
    try {
      const rows = await localAiRuntime.searchCatalog({
        query: searchQuery.trim(),
        capability: catalogCapability === 'all' ? undefined : catalogCapability,
        limit: 30,
      });
      // Filter out already installed models
      const notInstalled = rows.filter(item => !isInstalled(item.modelId));
      setCatalogItems(notInstalled);
    } catch {
      setCatalogItems([]);
    } finally {
      setLoadingCatalog(false);
    }
  }, [searchQuery, catalogCapability, isInstalled]);

  const refreshVerifiedModels = useCallback(async () => {
    try {
      const rows = await localAiRuntime.listVerified();
      // Filter out already installed models and limit to top 5
      const notInstalled = rows.filter(item => !isInstalled(item.modelId)).slice(0, 5);
      setVerifiedModels(notInstalled);
    } catch {
      setVerifiedModels([]);
    }
  }, [isInstalled]);

  // Auto search on query change
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalogItems();
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, catalogCapability, refreshCatalogItems]);

  // Load verified models on mount
  useEffect(() => {
    void refreshVerifiedModels();
  }, [refreshVerifiedModels]);

  // Downloads progress
  useEffect(() => {
    if (isModMode) return undefined;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void localAiRuntime.listDownloads()
      .then((sessions) => {
        if (disposed) return;
        const nowMs = Date.now();
        setProgressBySessionId((prev) => {
          const next = pruneProgressSessions(prev, nowMs);
          const merged: Record<string, ProgressSessionState> = { ...next };
          for (const session of sessions) {
            merged[session.installSessionId] = {
              event: toProgressEventFromSummary(session),
              updatedAtMs: parseTimestamp(session.updatedAt) || nowMs,
            };
          }
          return merged;
        });
      })
      .catch(() => {});
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
      if (event.done) {
        void props.onDownloadComplete?.(
          event.installSessionId,
          event.success,
          event.message,
          event.localModelId,
          event.modelId,
        );
        // Refresh verified models after download completes
        void refreshVerifiedModels();
      }
    }).then((off) => {
      if (disposed) {
        off();
        return;
      }
      unsubscribe = off;
    });
    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }, [isModMode, props.onDownloadComplete, refreshVerifiedModels]);

  const progressEvents = useMemo(
    () => Object.values(progressBySessionId)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, PROGRESS_SESSION_LIMIT)
      .map((item) => item.event),
    [progressBySessionId],
  );

  const activeDownloads = useMemo(
    () => progressEvents.filter((event) => (
      event.state === 'queued' || event.state === 'running' || event.state === 'paused' || event.state === 'failed'
    )),
    [progressEvents],
  );

  // Download controls
  const mergeSessionSummary = useCallback((installSessionId: string, updater: () => Promise<ReturnType<typeof toProgressEventFromSummary>>) => {
    void updater()
      .then((event) => {
        const nowMs = Date.now();
        setProgressBySessionId((prev) => ({
          ...prev,
          [installSessionId]: {
            event,
            updatedAtMs: nowMs,
          },
        }));
      })
      .catch(() => {});
  }, []);

  const onPauseDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(installSessionId, async () => 
      toProgressEventFromSummary(await localAiRuntime.pauseDownload(installSessionId, { caller: 'core' }))
    );
  }, [mergeSessionSummary]);

  const onResumeDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(installSessionId, async () => 
      toProgressEventFromSummary(await localAiRuntime.resumeDownload(installSessionId, { caller: 'core' }))
    );
  }, [mergeSessionSummary]);

  const onCancelDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(installSessionId, async () => 
      toProgressEventFromSummary(await localAiRuntime.cancelDownload(installSessionId, { caller: 'core' }))
    );
  }, [mergeSessionSummary]);

  // Mod mode
  if (isModMode) {
    const modCapabilities = props.runtimeDependencyTargets.find((item) => item.modId === selectedDependencyModId)?.consumeCapabilities || [];
    const capabilityStatuses = modCapabilities.map((cap) => {
      const localNode = props.state.localRuntime.nodeMatrix.find((node) => node.capability === cap && node.available);
      const hasLocalModel = props.state.localRuntime.models.some((model) => model.status === 'active' && model.capabilities.includes(cap));
      const localAvailable = Boolean(localNode) || hasLocalModel;
      return { capability: cap, localAvailable };
    });
    const hasUnavailable = capabilityStatuses.some((item) => !item.localAvailable);
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
        <div className="flex h-14 shrink-0 items-center bg-white px-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Local Models</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">
                  {props.runtimeDependencyTargets.find((item) => item.modId === selectedDependencyModId)?.modName || selectedDependencyModId || 'Runtime Mod'}
                </h4>
                <p className="text-xs text-gray-500">Configure only this mod&apos;s declared model dependencies.</p>
              </div>
              {modCapabilities.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-700">AI Capability Status</p>
                  <div className="flex flex-wrap gap-2">
                    {capabilityStatuses.map((item) => (
                      <span key={`mod-cap-status-${item.capability}`} className={`rounded-full px-3 py-1 text-[11px] font-medium ${item.localAvailable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.capability}: {item.localAvailable ? 'local-runtime' : 'needs setup'}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <ModelCenterDependencySection
                isModMode={isModMode}
                loadingDependencyPlan={loadingDependencyPlan}
                selectedDependencyModId={selectedDependencyModId}
                dependencySelectionLocked={dependencySelectionLocked}
                selectedDependencyTarget={props.runtimeDependencyTargets.find((item) => item.modId === selectedDependencyModId) || null}
                selectedDependencyCapability={selectedDependencyCapability}
                dependencyPlanPreview={dependencyPlanPreview}
                runtimeDependencyTargets={props.runtimeDependencyTargets}
                onSetSelectedDependencyModId={(modId) => {
                  if (!dependencySelectionLocked) {
                    setInternalSelectedDependencyModId(modId);
                    props.onSelectDependencyModId?.(modId);
                  }
                }}
                onSetSelectedDependencyCapability={setSelectedDependencyCapability}
                onResolveDependencyPlanPreview={() => void resolveDependencyPlanPreview()}
                onApplyDependencies={props.onApplyDependencies}
              />
            </div>
            {hasUnavailable ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-xs font-semibold text-amber-900">Setup Required</p>
                <p className="text-[11px] text-amber-800 mt-1">Some capabilities are not available locally. Install a local model or configure a cloud API connector to enable them.</p>
                <div className="flex items-center gap-2 mt-3">
                  <button type="button" onClick={() => props.onNavigateToSetup?.('local')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-amber-300 text-amber-700 hover:bg-amber-100">Install Models</button>
                  <button type="button" onClick={() => props.onNavigateToSetup?.('cloud')} className="px-3 py-1.5 text-xs font-medium rounded-lg text-amber-700 hover:bg-amber-100">Configure Cloud API</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Main layout - unified search + results
  const hasSearchQuery = searchQuery.trim().length > 0;
  const localRuntimeHealthy = props.state.localRuntime.status === 'healthy';
  const healthTooltip = formatLastCheckedAgo(props.state.localRuntime.lastCheckedAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Status Bar -->
          <div className="flex items-center justify-between">
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void props.onHealthCheck()}
                disabled={props.checkingHealth}
                title={healthTooltip}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  localRuntimeHealthy
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <HeartPulseIcon className="w-4 h-4" />
                {props.checkingHealth ? 'Checking...' : 'Health'}
              </button>
              <button
                type="button"
                onClick={() => void props.onDiscover()}
                disabled={props.discovering}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshIcon className="w-4 h-4" />
                {props.discovering ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {/* Unified Model Manager - Search + Installed */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-visible">
            {/* Header */}
            <div className="px-4 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mint-100 text-mint-600">
                  <SearchIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Model Catalog</h3>
                  <p className="text-xs text-gray-500">Search and install from Hugging Face or verified models</p>
                </div>
              </div>
              {/* Search Row */}
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search models by name, repo, or task..."
                    className="w-full h-10 pl-9 pr-4 rounded-lg border border-gray-200 text-sm focus:border-mint-400 focus:ring-2 focus:ring-mint-100 outline-none"
                  />
                </div>
                <RuntimeSelect
                  value={catalogCapability}
                  onChange={(nextCapability) => setCatalogCapability((nextCapability || 'all') as 'all' | CapabilityOption)}
                  className="w-40"
                  options={[
                    { value: 'all', label: 'All Capabilities' },
                    ...CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability })),
                  ]}
                />
              </div>
            </div>

            {/* Installed Models Section - Inside the same card */}
            <div className="bg-gray-50/50">
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
                <PackageIcon className="w-4 h-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Installed ({filteredInstalledModels.length})
                </span>
              </div>
              {filteredInstalledModels.length > 0 ? (
                <div className="divide-y divide-gray-100 bg-white">
                  {filteredInstalledModels.map((model) => (
                    <div key={model.localModelId} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <ModelIcon engine={model.engine} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{model.model}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{model.engine}</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{model.localModelId}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {model.capabilities.slice(0, 3).map((cap) => (
                            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-mint-50 text-mint-600 border border-mint-100">{cap}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded ${model.status === 'active' ? 'bg-green-100 text-green-700' : model.status === 'unhealthy' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          {model.status}
                        </span>
                        <Toggle
                          checked={model.status === 'active'}
                          onChange={() => model.status === 'active' ? props.onStop?.(model.localModelId) : props.onStart?.(model.localModelId)}
                        />
                        <button
                          type="button"
                          onClick={() => props.onRemove?.(model.localModelId)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Remove"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-center bg-white">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400 mb-3">
                    <PackageIcon className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 mb-1">
                    No Installed Models
                  </h3>
                </div>
              )}
            </div>

            {/* Search results shown directly under installed models */}
            {hasSearchQuery && (
              <div className="bg-gray-50/50 border-t border-gray-100">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Available to Install</span>
                </div>
                <div className="divide-y divide-gray-100 bg-white">
                  {/* Verified Models */}
                  {verifiedModels.map((item) => (
                    <div key={item.templateId} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                        <StarIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Verified</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{item.modelId}</p>
                        {item.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            setInstalling(true);
                            try {
                              await props.onInstallVerified(item.templateId);
                              setPendingHighlightModel(item.modelId);
                            } finally {
                              setInstalling(false);
                            }
                          })();
                        }}
                        disabled={installing}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-500 text-white text-xs font-medium hover:bg-mint-600 disabled:opacity-50"
                      >
                        <DownloadIcon className="w-3.5 h-3.5" />
                        Install
                      </button>
                    </div>
                  ))}
                  {/* Catalog Results */}
                  {catalogItems.map((item) => (
                    <div key={item.itemId} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <ModelIcon engine={item.engine} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{item.title || item.modelId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{item.engine}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">Hugging Face</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{item.modelId}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-1 rounded-full ${item.installAvailable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.installAvailable ? 'Ready' : 'Manual'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            setInstalling(true);
                            try {
                              await props.onInstallCatalogItem(item);
                              setPendingHighlightModel(item.modelId);
                            } finally {
                              setInstalling(false);
                            }
                          })();
                        }}
                        disabled={!item.installAvailable || installing}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-500 text-white text-xs font-medium hover:bg-mint-600 disabled:opacity-50"
                      >
                        <DownloadIcon className="w-3.5 h-3.5" />
                        Install
                      </button>
                    </div>
                  ))}
                </div>
                {catalogItems.length === 0 && verifiedModels.length === 0 && !loadingCatalog && (
                  <div className="px-4 py-8 text-center bg-white">
                    <p className="text-sm text-gray-500">No models found matching your search</p>
                  </div>
                )}
                {loadingCatalog && (
                  <div className="px-4 py-8 text-center bg-white">
                    <p className="text-sm text-gray-500">Searching...</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Active Downloads */}
          {activeDownloads.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Downloads ({activeDownloads.length})</h3>
              {activeDownloads.map((event) => {
                const isRunning = event.state === 'running';
                const isPaused = event.state === 'paused';
                const isFailed = event.state === 'failed';
                const canPause = event.state === 'queued' || isRunning;
                const canResume = isPaused || (isFailed && event.retryable);
                const canCancel = event.state !== 'completed' && event.state !== 'cancelled';

                return (
                  <div key={event.installSessionId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-red-100 text-red-600' : 'bg-mint-100 text-mint-600'}`}>
                        <DownloadIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{event.modelId}</p>
                        <p className="text-xs text-gray-500">{event.phase}</p>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${
                        isFailed ? 'bg-red-100 text-red-700' :
                        isPaused ? 'bg-amber-100 text-amber-700' :
                        isRunning ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {downloadStateLabel(event.state)}
                      </span>
                    </div>
                    {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
                      <div className="mb-2">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${isFailed ? 'bg-red-500' : 'bg-mint-500'}`}
                            style={{ width: `${Math.max(0, Math.min(100, Math.round((event.bytesReceived / event.bytesTotal) * 100)))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                          <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
                          {isRunning && <span>{formatSpeed(event.speedBytesPerSec)} · ETA {formatEta(event.etaSeconds)}</span>}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mb-2">{formatBytes(event.bytesReceived)} downloaded</p>
                    )}
                    <div className="flex items-center gap-2">
                      {canPause && (
                        <button onClick={() => onPauseDownload(event.installSessionId)} className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50">
                          Pause
                        </button>
                      )}
                      {canResume && (
                        <button onClick={() => onResumeDownload(event.installSessionId)} className="px-2 py-1 text-xs rounded bg-mint-500 text-white hover:bg-mint-600">
                          Resume
                        </button>
                      )}
                      {canCancel && (
                        <button onClick={() => onCancelDownload(event.installSessionId)} className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200">
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
