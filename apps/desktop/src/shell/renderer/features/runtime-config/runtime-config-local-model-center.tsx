import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiArtifactKind,
  type LocalAiArtifactRecord,
  type LocalAiDownloadProgressEvent,
  type GgufVariantDescriptor,
  type LocalAiDependencyResolutionPlan,
  type LocalAiCatalogItemDescriptor,
  type LocalAiVerifiedArtifactDescriptor,
  type LocalAiVerifiedModelDescriptor,
  type OrphanArtifactFile,
  type OrphanModelFile,
} from '@runtime/local-ai-runtime';
import { i18n } from '@renderer/i18n';
import {
  CAPABILITY_OPTIONS,
  PROGRESS_RETENTION_MS,
  type CapabilityOption,
  type InstallEngineOption,
  type LocalModelCenterProps,
  normalizeCapabilityOption,
  normalizeInstallEngine,
  parseTimestamp,
} from './runtime-config-model-center-utils';
import {
  filterInstalledArtifacts,
  sortVerifiedArtifactsForDisplay,
  sortVerifiedModelsForDisplay,
  isArtifactTaskTerminal,
  relatedArtifactsForModel,
  type ArtifactTaskState,
  type ArtifactTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { LocalModelCenterCatalogCard } from './runtime-config-local-model-center-catalog-card';
import {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterArtifactTasksSection,
  LocalModelCenterImportDialog,
  LocalModelCenterModModeView,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterToolbar,
  LocalModelCenterVerifiedArtifactsSection,
} from './runtime-config-local-model-center-sections';
import { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

export function LocalModelCenter(props: LocalModelCenterProps) {
  const [installing, setInstalling] = useState(false);
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

  const [variantPickerItem, setVariantPickerItem] = useState<LocalAiCatalogItemDescriptor | null>(null);
  const [variantList, setVariantList] = useState<GgufVariantDescriptor[]>([]);
  const [variantError, setVariantError] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});
  const [catalogEngineOverrides, setCatalogEngineOverrides] = useState<Record<string, InstallEngineOption>>({});
  const [orphanFiles, setOrphanFiles] = useState<OrphanModelFile[]>([]);
  const [orphanCapabilities, setOrphanCapabilities] = useState<Record<string, CapabilityOption>>({});
  const [orphanImportSessionByPath, setOrphanImportSessionByPath] = useState<Record<string, string>>({});
  const orphanImportSessionByPathRef = useRef<Record<string, string>>({});
  const [scaffoldingOrphan, setScaffoldingOrphan] = useState<string | null>(null);
  const [orphanError, setOrphanError] = useState('');
  const [artifactOrphanFiles, setArtifactOrphanFiles] = useState<OrphanArtifactFile[]>([]);
  const [artifactOrphanKinds, setArtifactOrphanKinds] = useState<Record<string, LocalAiArtifactKind>>({});
  const [scaffoldingArtifactOrphan, setScaffoldingArtifactOrphan] = useState<string | null>(null);
  const [artifactOrphanError, setArtifactOrphanError] = useState('');

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

  const sortedModels = useMemo(
    () => [...props.state.local.models].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) return rightRank - leftRank;
      return String(right.localModelId || '').localeCompare(String(left.localModelId || ''));
    }),
    [props.state.local.models],
  );

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

  const filteredInstalledArtifacts = useMemo(
    () => filterInstalledArtifacts(sortedInstalledArtifacts, artifactKindFilter, deferredSearchQuery.toLowerCase().trim()),
    [artifactKindFilter, deferredSearchQuery, sortedInstalledArtifacts],
  );
  const installedArtifactIds = useMemo(() => new Set(sortedInstalledArtifacts.map((artifact) => artifact.artifactId.toLowerCase())), [sortedInstalledArtifacts]);
  const installedArtifactsById = useMemo(() => new Map(sortedInstalledArtifacts.map((artifact) => [artifact.artifactId.toLowerCase(), artifact] as const)), [sortedInstalledArtifacts]);

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

  const searchQueryRef = useRef(deferredSearchQuery);
  searchQueryRef.current = deferredSearchQuery;
  const catalogCapabilityRef = useRef(catalogCapability);
  catalogCapabilityRef.current = catalogCapability;
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
      const notInstalled = sortVerifiedModelsForDisplay(rows.filter(item => !isInstalled(item.modelId))).slice(0, 5);
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

  const refreshArtifactOrphanFiles = useCallback(async () => {
    try {
      const orphans = await localAiRuntime.scanArtifactOrphans();
      setArtifactOrphanFiles(orphans);
      setArtifactOrphanError('');
    } catch {
      setArtifactOrphanFiles([]);
    }
  }, []);

  const refreshAllOrphanFiles = useCallback(async () => {
    await Promise.all([
      refreshOrphanFiles(),
      refreshArtifactOrphanFiles(),
    ]);
  }, [refreshArtifactOrphanFiles, refreshOrphanFiles]);

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
        void refreshAllOrphanFiles();
      });
      return;
    }
    setOrphanError(message || 'Import failed');
    void refreshAllOrphanFiles();
  }, [props.onDiscover, refreshAllOrphanFiles]);

  useEffect(() => {
    setCatalogDisplayCount(10);
  }, [deferredSearchQuery, catalogCapability]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalogItems();
    }, 600);
    return () => clearTimeout(timer);
  }, [deferredSearchQuery, catalogCapability, refreshCatalogItems]);

  useEffect(() => {
    void refreshVerifiedModels();
  }, [refreshVerifiedModels]);

  useEffect(() => {
    void refreshInstalledArtifacts();
  }, [refreshInstalledArtifacts]);

  useEffect(() => {
    void refreshVerifiedArtifacts();
  }, [refreshVerifiedArtifacts]);

  useEffect(() => {
    void refreshOrphanFiles();
  }, [refreshOrphanFiles]);

  useEffect(() => {
    void refreshArtifactOrphanFiles();
  }, [refreshArtifactOrphanFiles]);

  useEffect(() => {
    orphanImportSessionByPathRef.current = orphanImportSessionByPath;
  }, [orphanImportSessionByPath]);

  const visibleVerifiedArtifacts = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    const candidates = verifiedArtifacts.filter((artifact) => {
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
    return sortVerifiedArtifactsForDisplay(candidates);
  }, [deferredSearchQuery, installedArtifactIds, verifiedArtifacts]);
  const relatedArtifactsByModelTemplate = useMemo(() => {
    const next = new Map<string, LocalAiVerifiedArtifactDescriptor[]>();
    for (const model of verifiedModels) {
      next.set(model.templateId, sortVerifiedArtifactsForDisplay(relatedArtifactsForModel(model, verifiedArtifacts)));
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
        taskKind: 'verified-install',
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
      await installVerifiedArtifact(artifact.templateId);
    }
  }, [installVerifiedArtifact, installedArtifactsById]);

  const importArtifactManifest = useCallback(async () => {
    setArtifactBusy(true);
    try {
      await props.onImportArtifact();
      await refreshArtifactSections();
      await refreshAllOrphanFiles();
    } finally {
      setArtifactBusy(false);
    }
  }, [props, refreshAllOrphanFiles, refreshArtifactSections]);

  const removeInstalledArtifact = useCallback(async (localArtifactId: string) => {
    setArtifactBusy(true);
    try {
      await props.onRemoveArtifact(localArtifactId);
      await refreshArtifactSections();
    } finally {
      setArtifactBusy(false);
    }
  }, [props, refreshArtifactSections]);

  const installVerifiedModel = useCallback(async (templateId: string) => {
    setInstalling(true);
    try {
      await props.onInstallVerified(templateId);
    } finally {
      setInstalling(false);
    }
  }, [props]);

  const handleSettledDownload = useCallback((event: LocalAiDownloadProgressEvent) => {
    const orphanPath = Object.entries(orphanImportSessionByPathRef.current)
      .find(([, sessionId]) => sessionId === event.installSessionId)?.[0];
    if (orphanPath) {
      handleCompletedOrphanImport(orphanPath, event.success, event.message);
    }
    void refreshVerifiedModels();
  }, [handleCompletedOrphanImport, refreshVerifiedModels]);

  const {
    activeDownloads,
    getLatestProgressEvent,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
  } = useLocalModelCenterDownloads({
    isModMode,
    onDownloadComplete: props.onDownloadComplete,
    onProgressSettled: handleSettledDownload,
  });

  const scaffoldOrphanImport = useCallback((orphanPath: string) => {
    setScaffoldingOrphan(orphanPath);
    setOrphanError('');
    void localAiRuntime.scaffoldOrphan({
      path: orphanPath,
      capabilities: [orphanCapabilities[orphanPath] || 'chat'],
    }).then((accepted) => {
      setOrphanImportSessionByPath((prev) => ({
        ...prev,
        [orphanPath]: accepted.installSessionId,
      }));
      setScaffoldingOrphan(null);
      const currentProgress = getLatestProgressEvent(accepted.installSessionId);
      if (currentProgress?.done) {
        handleCompletedOrphanImport(orphanPath, currentProgress.success, currentProgress.message);
      }
    }).catch((error: unknown) => {
      setScaffoldingOrphan(null);
      setOrphanError(error instanceof Error ? error.message : String(error));
    });
  }, [getLatestProgressEvent, handleCompletedOrphanImport, orphanCapabilities]);

  const scaffoldArtifactOrphanImport = useCallback(async (orphanPath: string) => {
    const kind = artifactOrphanKinds[orphanPath] || 'vae';
    setArtifactBusy(true);
    setScaffoldingArtifactOrphan(orphanPath);
    setArtifactOrphanError('');
    try {
      await props.onScaffoldArtifactOrphan(orphanPath, kind);
      await refreshArtifactSections();
      await refreshAllOrphanFiles();
    } catch (error: unknown) {
      setArtifactOrphanError(
        error instanceof Error
          ? error.message
          : String(
            error
            || i18n.t('runtimeConfig.local.artifactImportFailed', {
              defaultValue: 'Artifact import failed',
            }),
          ),
      );
    } finally {
      setScaffoldingArtifactOrphan(null);
      setArtifactBusy(false);
    }
  }, [artifactOrphanKinds, props, refreshAllOrphanFiles, refreshArtifactSections]);

  const closeVariantPicker = useCallback(() => {
    setVariantPickerItem(null);
    setVariantList([]);
  }, []);

  const toggleVariantPicker = useCallback((item: LocalAiCatalogItemDescriptor) => {
    if (variantPickerItem?.itemId === item.itemId) {
      closeVariantPicker();
      return;
    }
    setVariantPickerItem(item);
    setVariantList([]);
    setVariantError('');
    setLoadingVariants(true);
    void localAiRuntime.listRepoGgufVariants(item.repo).then((variants) => {
      setVariantList(variants);
      setLoadingVariants(false);
    }).catch((error) => {
      setVariantList([]);
      setVariantError(
        error instanceof Error
          ? error.message
          : String(
            error
            || i18n.t('runtimeConfig.local.unknownError', {
              defaultValue: 'Unknown error',
            }),
          ),
      );
      setLoadingVariants(false);
    });
  }, [closeVariantPicker, variantPickerItem?.itemId]);

  const installCatalogVariant = useCallback(async (
    item: LocalAiCatalogItemDescriptor,
    variantFilename: string,
  ) => {
    closeVariantPicker();
    setInstalling(true);
    try {
      await props.onInstallCatalogItem(item, {
        entry: variantFilename,
        files: [variantFilename],
        capabilities: [selectedCatalogCapability(item)],
        engine: selectedCatalogEngine(item),
      });
    } finally {
      setInstalling(false);
    }
  }, [closeVariantPicker, props, selectedCatalogCapability, selectedCatalogEngine]);

  if (isModMode) {
    return (
      <LocalModelCenterModModeView
        state={props.state}
        selectedDependencyModId={selectedDependencyModId}
        loadingDependencyPlan={loadingDependencyPlan}
        dependencySelectionLocked={dependencySelectionLocked}
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
        onNavigateToSetup={props.onNavigateToSetup}
      />
    );
  }

  const hasSearchQuery = searchQuery.trim().length > 0;
  const localHealthy = props.state.local.status === 'healthy';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <LocalModelCenterToolbar
            checkingHealth={props.checkingHealth}
            localHealthy={localHealthy}
            lastCheckedAt={props.state.local.lastCheckedAt}
            discovering={props.discovering}
            importMenuRef={importMenuRef}
            showImportMenu={showImportMenu}
            onHealthCheck={() => void props.onHealthCheck()}
            onRefresh={() => {
              void props.onDiscover().finally(() => {
                void refreshAllOrphanFiles();
              });
            }}
            onToggleImportMenu={() => setShowImportMenu((prev) => !prev)}
            onOpenImportFile={() => {
              setShowImportMenu(false);
              setShowImportFileDialog(true);
            }}
            onImportManifest={() => {
              setShowImportMenu(false);
              void props.onImport();
            }}
            onImportArtifactManifest={() => {
              setShowImportMenu(false);
              void importArtifactManifest();
            }}
          />
          <LocalModelCenterImportDialog
            visible={showImportFileDialog}
            capability={importFileCapability}
            onCapabilityChange={setImportFileCapability}
            onClose={() => setShowImportFileDialog(false)}
            onChooseFile={() => {
              setShowImportFileDialog(false);
              void props.onImportFile([importFileCapability]);
            }}
          />
          <LocalModelCenterCatalogCard
            searchQuery={searchQuery}
            catalogCapability={catalogCapability}
            filteredInstalledModels={filteredInstalledModels}
            filteredInstalledArtifacts={filteredInstalledArtifacts}
            loadingCatalog={loadingCatalog}
            loadingInstalledArtifacts={loadingInstalledArtifacts}
            loadingVerifiedArtifacts={loadingVerifiedArtifacts}
            artifactKindFilter={artifactKindFilter}
            artifactBusy={artifactBusy}
            orphanFiles={orphanFiles}
            orphanError={orphanError}
            orphanCapabilities={orphanCapabilities}
            orphanImportSessionByPath={orphanImportSessionByPath}
            scaffoldingOrphan={scaffoldingOrphan}
            artifactOrphanFiles={artifactOrphanFiles}
            artifactOrphanError={artifactOrphanError}
            artifactOrphanKinds={artifactOrphanKinds}
            scaffoldingArtifactOrphan={scaffoldingArtifactOrphan}
            hasSearchQuery={hasSearchQuery}
            verifiedModels={verifiedModels}
            catalogItems={catalogItems}
            catalogDisplayCount={catalogDisplayCount}
            relatedArtifactsByModelTemplate={relatedArtifactsByModelTemplate}
            installedArtifactsById={installedArtifactsById}
            variantPickerItem={variantPickerItem}
            variantList={variantList}
            variantError={variantError}
            loadingVariants={loadingVariants}
            selectedCatalogCapability={selectedCatalogCapability}
            selectedCatalogEngine={selectedCatalogEngine}
            isArtifactPending={isArtifactPending}
            onSearchQueryChange={setSearchQuery}
            onCatalogCapabilityChange={setCatalogCapability}
            onStartModel={(localModelId) => { void props.onStart?.(localModelId); }}
            onStopModel={(localModelId) => { void props.onStop?.(localModelId); }}
            onRemoveModel={(localModelId) => { void props.onRemove?.(localModelId); }}
            onArtifactKindFilterChange={setArtifactKindFilter}
            onRefreshArtifacts={() => { void refreshArtifactSections(); }}
            onRemoveArtifact={(localArtifactId) => { void removeInstalledArtifact(localArtifactId); }}
            onOrphanCapabilityChange={(path, capability) => setOrphanCapabilities((prev) => ({
              ...prev,
              [path]: capability,
            }))}
            onScaffoldOrphan={scaffoldOrphanImport}
            onArtifactOrphanKindChange={(path, kind) => setArtifactOrphanKinds((prev) => ({
              ...prev,
              [path]: kind,
            }))}
            onScaffoldArtifactOrphan={(path) => { void scaffoldArtifactOrphanImport(path); }}
            onInstallMissingArtifacts={(artifacts) => { void installMissingArtifactsForModel(artifacts); }}
            onInstallVerifiedModel={(templateId) => { void installVerifiedModel(templateId); }}
            onInstallArtifact={(templateId) => { void installVerifiedArtifact(templateId); }}
            onToggleVariantPicker={toggleVariantPicker}
            onCloseVariantPicker={closeVariantPicker}
            onCatalogCapabilityOverrideChange={(itemId, capability) => setCatalogCapabilityOverrides((prev) => ({
              ...prev,
              [itemId]: capability,
            }))}
            onCatalogEngineOverrideChange={(itemId, engine) => setCatalogEngineOverrides((prev) => ({
              ...prev,
              [itemId]: engine,
            }))}
            onInstallCatalogVariant={(item, variantFilename) => { void installCatalogVariant(item, variantFilename); }}
            onLoadMoreCatalog={() => setCatalogDisplayCount((prev) => prev + 10)}
            installing={installing}
          />
          <LocalModelCenterVerifiedArtifactsSection
            hasSearchQuery={hasSearchQuery}
            loadingVerifiedArtifacts={loadingVerifiedArtifacts}
            artifactBusy={artifactBusy}
            visibleVerifiedArtifacts={visibleVerifiedArtifacts}
            isArtifactPending={isArtifactPending}
            onRefresh={() => { void refreshArtifactSections(); }}
            onInstallArtifact={(templateId) => { void installVerifiedArtifact(templateId); }}
          />
          <LocalModelCenterActiveDownloadsSection
            downloads={activeDownloads}
            onPause={onPauseDownload}
            onResume={onResumeDownload}
            onCancel={onCancelDownload}
          />
          <LocalModelCenterArtifactTasksSection
            tasks={visibleArtifactTasks}
            pendingTemplateIds={artifactPendingTemplateIds}
            onRetryTask={(templateId) => { void installVerifiedArtifact(templateId); }}
          />
          {!hasSearchQuery ? (
            <LocalModelCenterQuickPicksSection
              loadingVerifiedModels={loadingVerifiedModels}
              installing={installing}
              artifactBusy={artifactBusy}
              verifiedModels={verifiedModels}
              relatedArtifactsByModelTemplate={relatedArtifactsByModelTemplate}
              installedArtifactsById={installedArtifactsById}
              isArtifactPending={isArtifactPending}
              onRefresh={() => { void refreshVerifiedModels(); }}
              onInstallVerifiedModel={(templateId) => { void installVerifiedModel(templateId); }}
              onInstallArtifact={(templateId) => { void installVerifiedArtifact(templateId); }}
              onInstallMissingArtifacts={(artifacts) => { void installMissingArtifactsForModel(artifacts); }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
