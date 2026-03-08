import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiArtifactKind,
  type LocalAiArtifactRecord,
  type GgufVariantDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiVerifiedArtifactDescriptor,
  type LocalAiVerifiedModelDescriptor,
  type OrphanModelFile,
} from '@runtime/local-ai-runtime';
import { Tooltip } from '@renderer/components/tooltip.js';
import { RuntimeSelect } from '../primitives';
import { ModelCenterDependencySection } from './model-center-dependency-section';
import {
  CAPABILITY_OPTIONS,
  downloadStateLabel,
  PROGRESS_SESSION_LIMIT,
  PROGRESS_RETENTION_MS,
  INSTALL_ENGINE_OPTIONS,
  type CapabilityOption,
  type InstallEngineOption,
  type LocalRuntimeModelCenterProps,
  type ProgressSessionState,
  toProgressEventFromSummary,
  formatBytes,
  formatDownloadPhaseLabel,
  formatEta,
  formatSpeed,
  normalizeCapabilityOption,
  normalizeInstallEngine,
  parseTimestamp,
  pruneProgressSessions,
  sortProgressSessions,
} from './model-center-utils';

const ARTIFACT_KIND_OPTIONS = [
  'vae',
  'llm',
  'clip',
  'controlnet',
  'lora',
  'auxiliary',
] as const satisfies readonly LocalAiArtifactKind[];

function formatArtifactKindLabel(value: LocalAiArtifactKind): string {
  switch (value) {
    case 'vae':
      return 'VAE';
    case 'llm':
      return 'LLM';
    case 'clip':
      return 'CLIP';
    case 'controlnet':
      return 'ControlNet';
    case 'lora':
      return 'LoRA';
    case 'auxiliary':
      return 'Auxiliary';
    default:
      return value;
  }
}

const GENERIC_MODEL_TAGS = new Set([
  'verified',
  'chat',
  'image',
  'video',
  'tts',
  'stt',
  'embedding',
  'localai',
  'nexa',
]);

function normalizeDescriptorToken(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

function collectModelFamilyHints(model: LocalAiVerifiedModelDescriptor): string[] {
  const hints = new Set<string>();
  for (const tag of model.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

function collectArtifactFamilyHints(artifact: LocalAiVerifiedArtifactDescriptor): string[] {
  const hints = new Set<string>();
  const family = normalizeDescriptorToken(typeof artifact.metadata?.family === 'string' ? artifact.metadata.family : '');
  if (family) {
    hints.add(family);
  }
  for (const tag of artifact.tags || []) {
    const normalized = normalizeDescriptorToken(tag);
    if (!normalized || GENERIC_MODEL_TAGS.has(normalized)) {
      continue;
    }
    hints.add(normalized);
  }
  return [...hints];
}

function relatedArtifactsForModel(
  model: LocalAiVerifiedModelDescriptor,
  artifacts: LocalAiVerifiedArtifactDescriptor[],
): LocalAiVerifiedArtifactDescriptor[] {
  const capabilities = new Set((model.capabilities || []).map((value) => normalizeDescriptorToken(value)));
  if (!capabilities.has('image')) {
    return [];
  }
  const modelFamilies = new Set(collectModelFamilyHints(model));
  if (modelFamilies.size === 0) {
    return [];
  }
  return artifacts.filter((artifact) => {
    const artifactFamilies = collectArtifactFamilyHints(artifact);
    return artifactFamilies.some((family) => modelFamilies.has(family));
  });
}

type ArtifactTaskState = 'running' | 'completed' | 'failed';

type ArtifactTaskEntry = {
  templateId: string;
  artifactId: string;
  title: string;
  kind: LocalAiArtifactKind;
  state: ArtifactTaskState;
  detail?: string;
  updatedAtMs: number;
};

function isArtifactTaskTerminal(state: ArtifactTaskState): boolean {
  return state === 'completed' || state === 'failed';
}

function artifactTaskStatusLabel(state: ArtifactTaskState): string {
  if (state === 'running') return 'Installing';
  if (state === 'completed') return 'Installed';
  return 'Failed';
}

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

function FolderOpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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

const downloadSessionSnapshotCache: Record<string, ProgressSessionState> = {};

function cacheProgressSessions(
  sessions: Record<string, ProgressSessionState>,
): Record<string, ProgressSessionState> {
  for (const sessionId of Object.keys(downloadSessionSnapshotCache)) {
    if (!(sessionId in sessions)) {
      delete downloadSessionSnapshotCache[sessionId];
    }
  }
  Object.assign(downloadSessionSnapshotCache, sessions);
  return sessions;
}

export function LocalRuntimeModelCenter(props: LocalRuntimeModelCenterProps) {
  const [installing, setInstalling] = useState(false);
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>(
    () => ({ ...downloadSessionSnapshotCache }),
  );
  const progressBySessionIdRef = useRef<Record<string, ProgressSessionState>>({ ...downloadSessionSnapshotCache });
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<LocalAiCatalogItemDescriptor[]>([]);
  const [catalogDisplayCount, setCatalogDisplayCount] = useState(10);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [verifiedModels, setVerifiedModels] = useState<LocalAiVerifiedModelDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [installedArtifacts, setInstalledArtifacts] = useState<LocalAiArtifactRecord[]>([]);
  const [loadingInstalledArtifacts, setLoadingInstalledArtifacts] = useState(false);
  const [verifiedArtifacts, setVerifiedArtifacts] = useState<LocalAiVerifiedArtifactDescriptor[]>([]);
  const [loadingVerifiedArtifacts, setLoadingVerifiedArtifacts] = useState(false);
  const [artifactKindFilter, setArtifactKindFilter] = useState<'all' | LocalAiArtifactKind>('all');
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactPendingTemplateIds, setArtifactPendingTemplateIds] = useState<string[]>([]);
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTaskEntry[]>([]);
  const [internalSelectedDependencyModId, setInternalSelectedDependencyModId] = useState('');
  const [selectedDependencyCapability, setSelectedDependencyCapability] = useState<'auto' | CapabilityOption>('auto');
  const [dependencyPlanPreview, setDependencyPlanPreview] = useState<LocalAiDependencyResolutionPlan | null>(null);
  const [loadingDependencyPlan, setLoadingDependencyPlan] = useState(false);

  // Import state
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);
  const [importFileCapability, setImportFileCapability] = useState<CapabilityOption>('chat');
  const importMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showImportMenu) return undefined;
    const handler = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showImportMenu]);

  // Variant picker state
  const [variantPickerItem, setVariantPickerItem] = useState<LocalAiCatalogItemDescriptor | null>(null);
  const [variantList, setVariantList] = useState<GgufVariantDescriptor[]>([]);
  const [variantError, setVariantError] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});
  const [catalogEngineOverrides, setCatalogEngineOverrides] = useState<Record<string, InstallEngineOption>>({});

  // Orphan scan state
  const [orphanFiles, setOrphanFiles] = useState<OrphanModelFile[]>([]);
  const [orphanCapabilities, setOrphanCapabilities] = useState<Record<string, CapabilityOption>>({});
  const [orphanImportSessionByPath, setOrphanImportSessionByPath] = useState<Record<string, string>>({});
  const orphanImportSessionByPathRef = useRef<Record<string, string>>({});
  const [scaffoldingOrphan, setScaffoldingOrphan] = useState<string | null>(null);
  const [orphanError, setOrphanError] = useState('');

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

  useEffect(() => {
    setDependencyPlanPreview(null);
  }, [selectedDependencyCapability, selectedDependencyModId]);

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

  // Filter installed models by search (uses deferred value to avoid blocking input)
  const filteredInstalledModels = useMemo(() => {
    if (!deferredSearchQuery.trim()) return sortedModels;
    const query = deferredSearchQuery.toLowerCase().trim();
    return sortedModels.filter(m =>
      m.model.toLowerCase().includes(query) ||
      m.localModelId.toLowerCase().includes(query) ||
      m.engine.toLowerCase().includes(query)
    );
  }, [sortedModels, deferredSearchQuery]);

  const sortedInstalledArtifacts = useMemo(
    () => [...installedArtifacts].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) return rightRank - leftRank;
      return String(right.localArtifactId || '').localeCompare(String(left.localArtifactId || ''));
    }),
    [installedArtifacts],
  );

  const filteredInstalledArtifacts = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    return sortedInstalledArtifacts.filter((artifact) => {
      const matchesKind = artifactKindFilter === 'all' || artifact.kind === artifactKindFilter;
      if (!matchesKind) return false;
      if (!query) return true;
      return (
        artifact.artifactId.toLowerCase().includes(query)
        || artifact.localArtifactId.toLowerCase().includes(query)
        || artifact.engine.toLowerCase().includes(query)
        || artifact.kind.toLowerCase().includes(query)
        || artifact.source.repo.toLowerCase().includes(query)
      );
    });
  }, [artifactKindFilter, deferredSearchQuery, sortedInstalledArtifacts]);

  const installedArtifactIds = useMemo(() => (
    new Set(sortedInstalledArtifacts.map((artifact) => artifact.artifactId.toLowerCase()))
  ), [sortedInstalledArtifacts]);
  const installedArtifactsById = useMemo(() => (
    new Map(sortedInstalledArtifacts.map((artifact) => [artifact.artifactId.toLowerCase(), artifact] as const))
  ), [sortedInstalledArtifacts]);

  // Check if a catalog item is already installed
  const isInstalled = useCallback((modelId: string) => {
    return sortedModels.some(m => m.model.toLowerCase() === modelId.toLowerCase());
  }, [sortedModels]);

  const inferredCatalogCapability = useCallback((item: LocalAiCatalogItemDescriptor): CapabilityOption => (
    normalizeCapabilityOption(item.capabilities.find((capability) => (
      CAPABILITY_OPTIONS.includes(capability as CapabilityOption)
    )))
  ), []);

  const selectedCatalogCapability = useCallback((item: LocalAiCatalogItemDescriptor): CapabilityOption => (
    catalogCapabilityOverrides[item.itemId] || inferredCatalogCapability(item)
  ), [catalogCapabilityOverrides, inferredCatalogCapability]);

  const selectedCatalogEngine = useCallback((item: LocalAiCatalogItemDescriptor): InstallEngineOption => (
    catalogEngineOverrides[item.itemId] || normalizeInstallEngine(item.engine)
  ), [catalogEngineOverrides]);

  // Use refs for search state so refreshCatalogItems doesn't rebuild on every keystroke
  const searchQueryRef = useRef(deferredSearchQuery);
  searchQueryRef.current = deferredSearchQuery;
  const catalogCapabilityRef = useRef(catalogCapability);
  catalogCapabilityRef.current = catalogCapability;

  // Catalog search — stable callback that reads from refs
  const refreshCatalogItems = useCallback(async () => {
    const query = searchQueryRef.current.trim();
    const capability = catalogCapabilityRef.current;
    if (!query) {
      setCatalogItems([]);
      return;
    }
    setLoadingCatalog(true);
    try {
      const rows = await localAiRuntime.searchCatalog({
        query,
        capability: capability === 'all' ? undefined : capability,
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
  }, [isInstalled]);

  const refreshVerifiedModels = useCallback(async () => {
    setLoadingVerifiedModels(true);
    try {
      const rows = await localAiRuntime.listVerified();
      // Filter out already installed models and limit to top 5
      const notInstalled = rows.filter(item => !isInstalled(item.modelId)).slice(0, 5);
      setVerifiedModels(notInstalled);
    } catch {
      setVerifiedModels([]);
    } finally {
      setLoadingVerifiedModels(false);
    }
  }, [isInstalled]);

  const refreshInstalledArtifacts = useCallback(async () => {
    setLoadingInstalledArtifacts(true);
    try {
      const rows = await localAiRuntime.listArtifacts(
        artifactKindFilter === 'all' ? undefined : { kind: artifactKindFilter },
      );
      setInstalledArtifacts(rows);
    } catch {
      setInstalledArtifacts([]);
    } finally {
      setLoadingInstalledArtifacts(false);
    }
  }, [artifactKindFilter]);

  const refreshVerifiedArtifacts = useCallback(async () => {
    setLoadingVerifiedArtifacts(true);
    try {
      const rows = await localAiRuntime.listVerifiedArtifacts(
        artifactKindFilter === 'all' ? undefined : { kind: artifactKindFilter },
      );
      setVerifiedArtifacts(rows);
    } catch {
      setVerifiedArtifacts([]);
    } finally {
      setLoadingVerifiedArtifacts(false);
    }
  }, [artifactKindFilter]);

  const refreshOrphanFiles = useCallback(async () => {
    try {
      const orphans = await localAiRuntime.scanOrphans();
      setOrphanFiles(orphans);
      setOrphanError('');
    } catch {
      setOrphanFiles([]);
    }
  }, []);

  const handleCompletedOrphanImport = useCallback((orphanPath: string, success: boolean, message?: string) => {
    setOrphanImportSessionByPath((prev) => {
      if (!(orphanPath in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[orphanPath];
      return next;
    });
    if (success) {
      void props.onDiscover().finally(() => {
        void refreshOrphanFiles();
      });
      return;
    }
    setOrphanError(message || 'Import failed');
    void refreshOrphanFiles();
  }, [props.onDiscover, refreshOrphanFiles]);

  // Reset display count when search changes
  useEffect(() => {
    setCatalogDisplayCount(10);
  }, [deferredSearchQuery, catalogCapability]);

  // Auto search on query change with debounce (uses deferred value so input stays responsive)
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalogItems();
    }, 600);
    return () => clearTimeout(timer);
  }, [deferredSearchQuery, catalogCapability, refreshCatalogItems]);

  // Load verified models on mount
  useEffect(() => {
    void refreshVerifiedModels();
  }, [refreshVerifiedModels]);

  useEffect(() => {
    void refreshInstalledArtifacts();
  }, [refreshInstalledArtifacts]);

  useEffect(() => {
    void refreshVerifiedArtifacts();
  }, [refreshVerifiedArtifacts]);

  // Scan for orphan model files on mount
  useEffect(() => {
    void refreshOrphanFiles();
  }, [refreshOrphanFiles]);

  useEffect(() => {
    orphanImportSessionByPathRef.current = orphanImportSessionByPath;
  }, [orphanImportSessionByPath]);

  useEffect(() => {
    progressBySessionIdRef.current = progressBySessionId;
  }, [progressBySessionId]);

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
            const previous = next[session.installSessionId];
            merged[session.installSessionId] = {
              event: toProgressEventFromSummary(session),
              updatedAtMs: parseTimestamp(session.updatedAt) || nowMs,
              createdAtMs: previous?.createdAtMs || parseTimestamp(session.createdAt) || nowMs,
            };
          }
          return cacheProgressSessions(merged);
        });
      })
      .catch(() => {});
    void localAiRuntime.subscribeDownloadProgress((event) => {
      if (disposed) return;
      const nowMs = Date.now();
      setProgressBySessionId((prev) => {
        const next = pruneProgressSessions(prev, nowMs);
        const previous = next[event.installSessionId];
        return cacheProgressSessions({
          ...next,
          [event.installSessionId]: {
            event,
            updatedAtMs: nowMs,
            createdAtMs: previous?.createdAtMs || nowMs,
          },
        });
      });
      if (event.done) {
        void props.onDownloadComplete?.(
          event.installSessionId,
          event.success,
          event.message,
          event.localModelId,
          event.modelId,
        );
        const orphanPath = Object.entries(orphanImportSessionByPathRef.current)
          .find(([, sessionId]) => sessionId === event.installSessionId)?.[0];
        if (orphanPath) {
          handleCompletedOrphanImport(orphanPath, event.success, event.message);
        }
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
  }, [handleCompletedOrphanImport, isModMode, props.onDownloadComplete, refreshVerifiedModels]);

  const progressEvents = useMemo(
    () => sortProgressSessions(progressBySessionId)
      .slice(0, PROGRESS_SESSION_LIMIT)
      .map((item) => item.event),
    [progressBySessionId],
  );

  const visibleVerifiedArtifacts = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    return verifiedArtifacts.filter((artifact) => {
      if (installedArtifactIds.has(artifact.artifactId.toLowerCase())) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        artifact.artifactId.toLowerCase().includes(query)
        || artifact.title.toLowerCase().includes(query)
        || artifact.description.toLowerCase().includes(query)
        || artifact.kind.toLowerCase().includes(query)
        || artifact.repo.toLowerCase().includes(query)
      );
    });
  }, [deferredSearchQuery, installedArtifactIds, verifiedArtifacts]);
  const relatedArtifactsByModelTemplate = useMemo(() => {
    const next = new Map<string, LocalAiVerifiedArtifactDescriptor[]>();
    for (const model of verifiedModels) {
      next.set(model.templateId, relatedArtifactsForModel(model, verifiedArtifacts));
    }
    return next;
  }, [verifiedArtifacts, verifiedModels]);
  const verifiedArtifactsByTemplateId = useMemo(() => (
    new Map(verifiedArtifacts.map((artifact) => [artifact.templateId, artifact] as const))
  ), [verifiedArtifacts]);
  const visibleArtifactTasks = useMemo(
    () => artifactTasks
      .slice()
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, 4),
    [artifactTasks],
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
        setProgressBySessionId((prev) => cacheProgressSessions({
          ...pruneProgressSessions(prev, nowMs),
          [installSessionId]: {
            event,
            updatedAtMs: nowMs,
            createdAtMs: prev[installSessionId]?.createdAtMs || nowMs,
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

  const refreshArtifactSections = useCallback(async () => {
    await Promise.all([
      refreshInstalledArtifacts(),
      refreshVerifiedArtifacts(),
    ]);
  }, [refreshInstalledArtifacts, refreshVerifiedArtifacts]);

  const markArtifactPending = useCallback((templateId: string, pending: boolean) => {
    const normalized = String(templateId || '').trim();
    if (!normalized) {
      return;
    }
    setArtifactPendingTemplateIds((prev) => {
      if (pending) {
        return prev.includes(normalized) ? prev : [...prev, normalized];
      }
      return prev.filter((item) => item !== normalized);
    });
  }, []);

  const upsertArtifactTask = useCallback((
    templateId: string,
    state: ArtifactTaskState,
    detail?: string,
  ) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return;
    }
    const descriptor = verifiedArtifactsByTemplateId.get(normalizedTemplateId);
    if (!descriptor) {
      return;
    }
    const nowMs = Date.now();
    setArtifactTasks((prev) => {
      const next = prev
        .filter((task) => (
          task.templateId !== normalizedTemplateId
          && !(isArtifactTaskTerminal(task.state) && nowMs - task.updatedAtMs > PROGRESS_RETENTION_MS)
        ));
      next.unshift({
        templateId: normalizedTemplateId,
        artifactId: descriptor.artifactId,
        title: descriptor.title,
        kind: descriptor.kind,
        state,
        detail: String(detail || '').trim() || undefined,
        updatedAtMs: nowMs,
      });
      return next.slice(0, 8);
    });
  }, [verifiedArtifactsByTemplateId]);

  const isArtifactPending = useCallback((templateId: string) => (
    artifactPendingTemplateIds.includes(String(templateId || '').trim())
  ), [artifactPendingTemplateIds]);

  const installVerifiedArtifact = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return;
    }
    markArtifactPending(normalizedTemplateId, true);
    upsertArtifactTask(normalizedTemplateId, 'running');
    try {
      await props.onInstallVerifiedArtifact(normalizedTemplateId);
      await refreshArtifactSections();
      upsertArtifactTask(normalizedTemplateId, 'completed', 'Artifact installed and ready.');
    } catch (error: unknown) {
      upsertArtifactTask(
        normalizedTemplateId,
        'failed',
        error instanceof Error ? error.message : String(error || 'Artifact install failed'),
      );
      throw error;
    } finally {
      markArtifactPending(normalizedTemplateId, false);
    }
  }, [markArtifactPending, props, refreshArtifactSections, upsertArtifactTask]);

  const installMissingArtifactsForModel = useCallback(async (artifacts: LocalAiVerifiedArtifactDescriptor[]) => {
    const missing = artifacts.filter((artifact) => !installedArtifactsById.has(artifact.artifactId.toLowerCase()));
    if (missing.length === 0) {
      return;
    }
    for (const artifact of missing) {
      // Keep installs serialized to avoid duplicate refresh races and clearer UI state.
      // eslint-disable-next-line no-await-in-loop
      await installVerifiedArtifact(artifact.templateId);
    }
  }, [installVerifiedArtifact, installedArtifactsById]);

  const importArtifactManifest = useCallback(async () => {
    setArtifactBusy(true);
    try {
      await props.onImportArtifact();
      await refreshArtifactSections();
    } finally {
      setArtifactBusy(false);
    }
  }, [props, refreshArtifactSections]);

  const removeInstalledArtifact = useCallback(async (localArtifactId: string) => {
    setArtifactBusy(true);
    try {
      await props.onRemoveArtifact(localArtifactId);
      await refreshArtifactSections();
    } finally {
      setArtifactBusy(false);
    }
  }, [props, refreshArtifactSections]);

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
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="flex h-14 shrink-0 items-center bg-white px-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Local Models</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div className="space-y-4 rounded-2xl bg-white p-6 shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
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
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Status Bar */}
          <div className="flex items-center justify-between">
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <Tooltip content={healthTooltip} placement="top">
                <button
                  type="button"
                  onClick={() => void props.onHealthCheck()}
                  disabled={props.checkingHealth}
                  aria-label={healthTooltip}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                    localRuntimeHealthy
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <HeartPulseIcon className="w-4 h-4" />
                  {props.checkingHealth ? 'Checking...' : 'Health'}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={() => {
                  void props.onDiscover().finally(() => {
                    void refreshOrphanFiles();
                  });
                }}
                disabled={props.discovering}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshIcon className="w-4 h-4" />
                {props.discovering ? 'Refreshing...' : 'Refresh'}
              </button>
              <div className="relative" ref={importMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowImportMenu((prev) => !prev)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  <FolderOpenIcon className="w-4 h-4" />
                  Import
                </button>
                {showImportMenu && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setShowImportMenu(false);
                        setShowImportFileDialog(true);
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs hover:bg-gray-50 rounded-t-lg"
                    >
                      <div className="font-medium text-gray-900">Import Model File</div>
                      <div className="text-gray-500 mt-0.5">.gguf, .safetensors, .bin, .onnx</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowImportMenu(false);
                        void props.onImport();
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs hover:bg-gray-50 border-t border-gray-100"
                    >
                      <div className="font-medium text-gray-900">Import Model Manifest</div>
                      <div className="text-gray-500 mt-0.5">model.manifest.json</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowImportMenu(false);
                        void importArtifactManifest();
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs hover:bg-gray-50 rounded-b-lg border-t border-gray-100"
                    >
                      <div className="font-medium text-gray-900">Import Artifact Manifest</div>
                      <div className="text-gray-500 mt-0.5">artifact.manifest.json</div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Unified Model Manager - Search + Installed */}
          {/* Import File Dialog */}
          {showImportFileDialog && (
            <div className="rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FolderOpenIcon className="w-4 h-4 text-mint-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Import Local Model File</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImportFileDialog(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Capability:</span>
                  <RuntimeSelect
                    value={importFileCapability}
                    onChange={(v) => setImportFileCapability((v || 'chat') as CapabilityOption)}
                    className="w-36"
                    options={CAPABILITY_OPTIONS.map((cap) => ({ value: cap, label: cap }))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowImportFileDialog(false);
                    void props.onImportFile([importFileCapability]);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-500 text-white text-xs font-medium hover:bg-mint-600"
                >
                  <FolderOpenIcon className="w-3.5 h-3.5" />
                  Choose File
                </button>
              </div>
            </div>
          )}

          <div className="overflow-visible rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
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
                    className="h-10 w-full rounded-lg border border-mint-100 bg-[#F4FBF8] pl-9 pr-4 text-sm outline-none focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                  />
                </div>
                <RuntimeSelect
                  value={catalogCapability}
                  onChange={(nextCapability) => setCatalogCapability((nextCapability || 'all') as 'all' | CapabilityOption)}
                  className="w-52"
                  options={[
                    { value: 'all', label: 'All Capabilities' },
                    ...CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability })),
                  ]}
                />
              </div>
            </div>

            {/* Installed Models Section - Inside the same card */}
            <div className="rounded-b-xl bg-white/60">
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
                <PackageIcon className="w-4 h-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Installed ({filteredInstalledModels.length})
                </span>
              </div>
              {filteredInstalledModels.length > 0 ? (
                <div className="divide-y divide-gray-200/80">
                  {filteredInstalledModels.map((model) => (
                    <div key={model.localModelId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
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
                        <Tooltip content="Remove" placement="top">
                          <button
                            type="button"
                            onClick={() => props.onRemove?.(model.localModelId)}
                            className="p-1.5 rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            aria-label="Remove"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-center">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400 mb-3">
                    <PackageIcon className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 mb-1">
                    No Installed Models
                  </h3>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 bg-white/60">
              <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FolderOpenIcon className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Companion Assets ({filteredInstalledArtifacts.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <RuntimeSelect
                    value={artifactKindFilter}
                    onChange={(next) => setArtifactKindFilter((next || 'all') as 'all' | LocalAiArtifactKind)}
                    className="w-36"
                    options={[
                      { value: 'all', label: 'All Kinds' },
                      ...ARTIFACT_KIND_OPTIONS.map((kind) => ({
                        value: kind,
                        label: formatArtifactKindLabel(kind),
                      })),
                    ]}
                  />
                  <button
                    type="button"
                    onClick={() => void refreshArtifactSections()}
                    disabled={loadingInstalledArtifacts || loadingVerifiedArtifacts || artifactBusy}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RefreshIcon className="w-3 h-3" />
                    Refresh
                  </button>
                </div>
              </div>
              {loadingInstalledArtifacts ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-gray-500">Loading companion assets...</p>
                </div>
              ) : filteredInstalledArtifacts.length > 0 ? (
                <div className="divide-y divide-gray-200/80">
                  {filteredInstalledArtifacts.map((artifact) => (
                    <div key={artifact.localArtifactId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
                        {formatArtifactKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{artifact.artifactId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {formatArtifactKindLabel(artifact.kind)}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            {artifact.engine}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{artifact.localArtifactId}</p>
                        <p className="text-[11px] text-gray-400 truncate">{artifact.entry}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded ${artifact.status === 'active' ? 'bg-green-100 text-green-700' : artifact.status === 'unhealthy' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          {artifact.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => { void removeInstalledArtifact(artifact.localArtifactId); }}
                          disabled={artifactBusy}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          title="Remove artifact"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400 mb-3">
                    <FolderOpenIcon className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 mb-1">No Companion Assets</h3>
                  <p className="text-xs text-gray-500">Import `artifact.manifest.json` files or install verified VAE/LLM assets below.</p>
                </div>
              )}
            </div>

            {/* Orphan files section */}
            {orphanFiles.length > 0 && (
              <div className="border-t border-amber-200 bg-amber-50/50">
                <div className="px-4 py-2 border-b border-amber-200 flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                    Unregistered Models Found ({orphanFiles.length})
                  </span>
                </div>
                {orphanError && (
                  <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
                    {orphanError}
                  </div>
                )}
                <div className="divide-y divide-amber-100">
                  {orphanFiles.map((orphan) => (
                    <div key={orphan.path} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <FolderOpenIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{orphan.filename}</div>
                        <div className="text-xs text-gray-500">{formatBytes(orphan.sizeBytes)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <RuntimeSelect
                          value={orphanCapabilities[orphan.path] || 'chat'}
                          onChange={(v) => setOrphanCapabilities((prev) => ({
                            ...prev,
                            [orphan.path]: (v || 'chat') as CapabilityOption,
                          }))}
                          className="w-32"
                          options={CAPABILITY_OPTIONS.map((cap) => ({ value: cap, label: cap }))}
                        />
                        <button
                          type="button"
                          disabled={scaffoldingOrphan === orphan.path || Boolean(orphanImportSessionByPath[orphan.path])}
                          onClick={() => {
                            setScaffoldingOrphan(orphan.path);
                            setOrphanError('');
                            localAiRuntime.scaffoldOrphan({
                              path: orphan.path,
                              capabilities: [orphanCapabilities[orphan.path] || 'chat'],
                            }).then((accepted) => {
                              setOrphanImportSessionByPath((prev) => ({
                                ...prev,
                                [orphan.path]: accepted.installSessionId,
                              }));
                              setScaffoldingOrphan(null);
                              const currentProgress = progressBySessionIdRef.current[accepted.installSessionId]?.event;
                              if (currentProgress?.done) {
                                handleCompletedOrphanImport(orphan.path, currentProgress.success, currentProgress.message);
                              }
                            }).catch((err: unknown) => {
                              setScaffoldingOrphan(null);
                              setOrphanError(err instanceof Error ? err.message : String(err));
                            });
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-50"
                        >
                          <DownloadIcon className="w-3 h-3" />
                          {(scaffoldingOrphan === orphan.path || orphanImportSessionByPath[orphan.path]) ? 'Importing...' : 'Import'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search results shown directly under installed models */}
            {hasSearchQuery && (
              <div className="border-t border-gray-200 bg-white/60">
                <div className="px-4 py-2 border-b border-gray-200 bg-white/70">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Available to Install</span>
                </div>
                <div className="divide-y divide-gray-200/80">
                  {/* Verified Models */}
                  {verifiedModels.map((item) => {
                    const relatedArtifacts = relatedArtifactsByModelTemplate.get(item.templateId) || [];
                    const missingArtifacts = relatedArtifacts.filter((artifact) => !installedArtifactsById.has(artifact.artifactId.toLowerCase()));
                    const hasPendingMissingArtifacts = missingArtifacts.some((artifact) => isArtifactPending(artifact.templateId));
                    return (
                    <div key={item.templateId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
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
                        {relatedArtifacts.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {missingArtifacts.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => { void installMissingArtifactsForModel(relatedArtifacts); }}
                                disabled={artifactBusy || hasPendingMissingArtifacts}
                                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                              >
                                {hasPendingMissingArtifacts ? 'Installing assets...' : `Install Missing (${missingArtifacts.length})`}
                              </button>
                            ) : null}
                            {relatedArtifacts.map((artifact) => {
                              const installed = installedArtifactsById.get(artifact.artifactId.toLowerCase()) || null;
                              const pending = isArtifactPending(artifact.templateId);
                              return (
                                <div
                                  key={`${item.templateId}-${artifact.templateId}`}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                                    installed
                                      ? 'border-green-200 bg-green-50 text-green-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  <span>{formatArtifactKindLabel(artifact.kind)}</span>
                                  <span>{installed ? 'Installed' : pending ? 'Installing' : 'Required'}</span>
                                  {!installed ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void installVerifiedArtifact(artifact.templateId);
                                      }}
                                      disabled={artifactBusy || installing || pending}
                                      className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-white disabled:opacity-50"
                                    >
                                      {pending ? 'Installing...' : 'Install'}
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            setInstalling(true);
                            try {
                              await props.onInstallVerified(item.templateId);
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
                    );
                  })}
                  {/* Catalog Results (paginated) */}
                  {catalogItems.slice(0, catalogDisplayCount).map((item) => (
                    <div key={item.itemId}>
                      <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                        <ModelIcon engine={item.engine} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{item.title || item.modelId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{item.engine}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-mint-50 text-mint-700">Hugging Face</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{item.modelId}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(item.capabilities.length > 0 ? item.capabilities : ['chat']).map((capability) => (
                            <span key={`${item.itemId}-${capability}`} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {capability}
                            </span>
                          ))}
                        </div>
                      </div>
                        <span className={`text-[10px] px-2 py-1 rounded-full ${item.installAvailable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {item.installAvailable ? 'Ready' : 'Manual'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (variantPickerItem?.itemId === item.itemId) {
                              setVariantPickerItem(null);
                              setVariantList([]);
                              return;
                            }
                            setVariantPickerItem(item);
                            setVariantList([]);
                            setVariantError('');
                            setLoadingVariants(true);
                            void localAiRuntime.listRepoGgufVariants(item.repo).then((variants) => {
                              setVariantList(variants);
                              setLoadingVariants(false);
                            }).catch((err) => {
                              setVariantList([]);
                              setVariantError(err instanceof Error ? err.message : String(err || 'Unknown error'));
                              setLoadingVariants(false);
                            });
                          }}
                          disabled={!item.installAvailable || installing}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-500 text-white text-xs font-medium hover:bg-mint-600 disabled:opacity-50"
                        >
                          <DownloadIcon className="w-3.5 h-3.5" />
                          Install
                        </button>
                      </div>
                      {/* Variant picker */}
                      {variantPickerItem?.itemId === item.itemId && (
                        <div className="px-4 pb-3 bg-gray-50/80">
                          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                              <span className="text-xs font-semibold text-gray-500">Select Variant</span>
                              <button
                                type="button"
                                onClick={() => { setVariantPickerItem(null); setVariantList([]); }}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                Close
                              </button>
                            </div>
                            <div className="px-3 py-3 border-b border-gray-100 bg-[#F7FBF8]">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Capability</p>
                                  <RuntimeSelect
                                    value={selectedCatalogCapability(item)}
                                    onChange={(next) => setCatalogCapabilityOverrides((prev) => ({
                                      ...prev,
                                      [item.itemId]: normalizeCapabilityOption(next),
                                    }))}
                                    className="w-full"
                                    options={CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability }))}
                                  />
                                  <p className="mt-1 text-[10px] text-gray-500">
                                    Detected: {(item.capabilities.length > 0 ? item.capabilities : ['chat']).join(', ')}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Engine</p>
                                  <RuntimeSelect
                                    value={selectedCatalogEngine(item)}
                                    onChange={(next) => setCatalogEngineOverrides((prev) => ({
                                      ...prev,
                                      [item.itemId]: normalizeInstallEngine(next),
                                    }))}
                                    className="w-full"
                                    options={INSTALL_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
                                  />
                                  <p className="mt-1 text-[10px] text-gray-500">
                                    Detected: {normalizeInstallEngine(item.engine)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {loadingVariants ? (
                              <div className="px-3 py-4 text-center">
                                <p className="text-xs text-gray-500">Loading variants...</p>
                              </div>
                            ) : variantList.length === 0 ? (
                              <div className="px-3 py-4 text-center">
                                <p className="text-xs text-gray-500">{variantError ? `Error: ${variantError}` : 'No GGUF variants found'}</p>
                              </div>
                            ) : (
                              <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                                {variantList.map((variant) => (
                                  <button
                                    key={variant.filename}
                                    type="button"
                                    disabled={installing}
                                    onClick={() => {
                                      setVariantPickerItem(null);
                                      setVariantList([]);
                                      void (async () => {
                                        setInstalling(true);
                                        try {
                                          await props.onInstallCatalogItem(item, {
                                            entry: variant.filename,
                                            files: [variant.filename],
                                            capabilities: [selectedCatalogCapability(item)],
                                            engine: selectedCatalogEngine(item),
                                          });
                                        } finally {
                                          setInstalling(false);
                                        }
                                      })();
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-mint-50 disabled:opacity-50"
                                  >
                                    <span className="text-xs font-medium text-gray-800 truncate">{variant.filename}</span>
                                    {typeof variant.sizeBytes === 'number' && (
                                      <span className="text-[10px] text-gray-500 ml-2 shrink-0">{formatBytes(variant.sizeBytes)}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {catalogItems.length > catalogDisplayCount && (
                  <div className="px-4 py-3 border-t border-gray-100 text-center">
                    <button
                      type="button"
                      onClick={() => setCatalogDisplayCount((prev) => prev + 10)}
                      className="px-4 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      Load More ({catalogItems.length - catalogDisplayCount} remaining)
                    </button>
                  </div>
                )}
                {catalogItems.length === 0 && verifiedModels.length === 0 && !loadingCatalog && (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-500">No models found matching your search</p>
                  </div>
                )}
                {loadingCatalog && (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-500">Searching...</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FolderOpenIcon className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Verified Companion Assets</span>
              </div>
              <button
                type="button"
                onClick={() => void refreshArtifactSections()}
                disabled={loadingVerifiedArtifacts || artifactBusy}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshIcon className="w-3 h-3" />
                Refresh
              </button>
            </div>
            {loadingVerifiedArtifacts ? (
              <div className="py-6 text-center">
                <p className="text-sm text-gray-500">Loading verified artifacts...</p>
              </div>
            ) : visibleVerifiedArtifacts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleVerifiedArtifacts.slice(0, hasSearchQuery ? 12 : 6).map((artifact) => (
                  (() => {
                    const pending = isArtifactPending(artifact.templateId);
                    return (
                  <div key={artifact.templateId} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-mint-200 hover:bg-mint-50/30 transition-colors">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-white text-[11px] font-semibold">
                      {formatArtifactKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{artifact.title}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {formatArtifactKindLabel(artifact.kind)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{artifact.artifactId}</p>
                      {artifact.description ? (
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{artifact.description}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => { void installVerifiedArtifact(artifact.templateId); }}
                      disabled={artifactBusy || pending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-500 text-white text-xs font-medium hover:bg-mint-600 disabled:opacity-50"
                    >
                      <DownloadIcon className="w-3.5 h-3.5" />
                      {pending ? 'Installing...' : 'Install'}
                    </button>
                  </div>
                    );
                  })()
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <p className="text-sm text-gray-500">
                  {hasSearchQuery
                    ? 'No verified companion assets matched your search.'
                    : 'No verified companion assets available for the current filter.'}
                </p>
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
                const phaseLabel = formatDownloadPhaseLabel(event.phase);
                const progressMeta = event.phase === 'verify'
                  ? (event.speedBytesPerSec && event.speedBytesPerSec > 0
                      ? `${formatSpeed(event.speedBytesPerSec)} verify · ETA ${formatEta(event.etaSeconds)}`
                      : 'Verifying local file...')
                  : event.phase === 'upsert'
                    ? 'Finalizing installation...'
                    : event.speedBytesPerSec && event.speedBytesPerSec > 0
                      ? `${formatSpeed(event.speedBytesPerSec)} · ETA ${formatEta(event.etaSeconds)}`
                      : 'Measuring throughput...';

                return (
                  <div key={event.installSessionId} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-red-100 text-red-600' : 'bg-mint-100 text-mint-600'}`}>
                        <DownloadIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{event.modelId}</p>
                        <p className="text-xs text-gray-500">{phaseLabel}</p>
                        {event.phase !== 'download' && event.message && (
                          <p className="text-[11px] text-gray-400 truncate">{event.message}</p>
                        )}
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
                          {isRunning && <span>{progressMeta}</span>}
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

          {visibleArtifactTasks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Asset Tasks ({visibleArtifactTasks.length})</h3>
              <div className="grid grid-cols-1 gap-3">
                {visibleArtifactTasks.map((task) => {
                  const isRunning = task.state === 'running';
                  const isFailed = task.state === 'failed';
                  return (
                    <div key={`artifact-task-${task.templateId}`} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          isFailed ? 'bg-red-100 text-red-600' : isRunning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                        }`}>
                          <FolderOpenIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {formatArtifactKindLabel(task.kind)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate">{task.artifactId}</p>
                          {task.detail ? (
                            <p className={`mt-0.5 text-[11px] truncate ${isFailed ? 'text-red-500' : 'text-gray-400'}`}>{task.detail}</p>
                          ) : null}
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${
                          isFailed ? 'bg-red-100 text-red-700' : isRunning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {artifactTaskStatusLabel(task.state)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}


          {/* Quick Picks - Only show when no search */}
          {!hasSearchQuery && verifiedModels.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <StarIcon className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quick Picks</span>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshVerifiedModels()}
                  disabled={loadingVerifiedModels}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  <RefreshIcon className="w-3 h-3" />
                  Refresh
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {verifiedModels.map((item) => {
                  const relatedArtifacts = relatedArtifactsByModelTemplate.get(item.templateId) || [];
                  const missingArtifacts = relatedArtifacts.filter((artifact) => !installedArtifactsById.has(artifact.artifactId.toLowerCase()));
                  const hasPendingMissingArtifacts = missingArtifacts.some((artifact) => isArtifactPending(artifact.templateId));
                  return (
                  <div key={item.templateId} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-mint-200 hover:bg-mint-50/30 transition-colors">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                      <StarIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                      <p className="text-xs text-gray-500 truncate">{item.modelId}</p>
                      {relatedArtifacts.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {missingArtifacts.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => { void installMissingArtifactsForModel(relatedArtifacts); }}
                              disabled={artifactBusy || hasPendingMissingArtifacts}
                              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                            >
                              {hasPendingMissingArtifacts ? 'Installing assets...' : `Install Missing (${missingArtifacts.length})`}
                            </button>
                          ) : null}
                          {relatedArtifacts.map((artifact) => {
                            const installed = installedArtifactsById.get(artifact.artifactId.toLowerCase()) || null;
                            const pending = isArtifactPending(artifact.templateId);
                            return (
                              <div
                                key={`${item.templateId}-quick-${artifact.templateId}`}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                                  installed
                                    ? 'border-green-200 bg-green-50 text-green-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                                }`}
                              >
                                <span>{formatArtifactKindLabel(artifact.kind)}</span>
                                <span>{installed ? 'Installed' : pending ? 'Installing' : 'Required'}</span>
                                {!installed ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void installVerifiedArtifact(artifact.templateId);
                                    }}
                                    disabled={artifactBusy || pending}
                                    className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-white disabled:opacity-50"
                                  >
                                    {pending ? 'Installing...' : 'Install'}
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          setInstalling(true);
                          try {
                            await props.onInstallVerified(item.templateId);
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
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
