import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeArtifactKind,
  type LocalRuntimeArtifactRecord,
  type LocalRuntimeCatalogItemDescriptor,
  type LocalRuntimeVerifiedArtifactDescriptor,
  type LocalRuntimeVerifiedModelDescriptor,
  type OrphanArtifactFile,
  type OrphanModelFile,
} from '@runtime/local-runtime';
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
  type ArtifactTaskEntry,
  type ArtifactTaskState,
} from './runtime-config-local-model-center-helpers';
import { toCanonicalLocalLookupKey } from '@runtime/local-runtime/local-id';
import { useLocalModelCenterImportActions } from './runtime-config-use-local-model-center-import-actions';

type UseLocalModelCenterRuntimeStateInput = {
  isModMode: boolean;
  props: LocalModelCenterProps;
};
export function useLocalModelCenterRuntimeState({ isModMode, props }: UseLocalModelCenterRuntimeStateInput) {
  const [installing, setInstalling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<LocalRuntimeCatalogItemDescriptor[]>([]);
  const [catalogDisplayCount, setCatalogDisplayCount] = useState(10);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [verifiedModels, setVerifiedModels] = useState<LocalRuntimeVerifiedModelDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [installedArtifacts, setInstalledArtifacts] = useState<LocalRuntimeArtifactRecord[]>([]);
  const [loadingInstalledArtifacts, setLoadingInstalledArtifacts] = useState(false);
  const [verifiedArtifacts, setVerifiedArtifacts] = useState<LocalRuntimeVerifiedArtifactDescriptor[]>([]);
  const [loadingVerifiedArtifacts, setLoadingVerifiedArtifacts] = useState(false);
  const [artifactKindFilter, setArtifactKindFilter] = useState<'all' | LocalRuntimeArtifactKind>('all');
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactPendingTemplateIds, setArtifactPendingTemplateIds] = useState<string[]>([]);
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTaskEntry[]>([]);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);
  const [importFileCapability, setImportFileCapability] = useState<CapabilityOption>('chat');
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});
  const [catalogEngineOverrides, setCatalogEngineOverrides] = useState<Record<string, InstallEngineOption>>({});
  const [orphanFiles, setOrphanFiles] = useState<OrphanModelFile[]>([]);
  const [orphanCapabilities, setOrphanCapabilities] = useState<Record<string, CapabilityOption>>({});
  const [artifactOrphanFiles, setArtifactOrphanFiles] = useState<OrphanArtifactFile[]>([]);
  const [artifactOrphanKinds, setArtifactOrphanKinds] = useState<Record<string, LocalRuntimeArtifactKind>>({});
  useEffect(() => {
    if (!showImportMenu) {
      return undefined;
    }
    const handler = (event: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target as Node)) {
        setShowImportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showImportMenu]);
  const sortedModels = useMemo(
    () => [...props.state.local.models].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return String(right.localModelId || '').localeCompare(String(left.localModelId || ''));
    }),
    [props.state.local.models],
  );
  const filteredInstalledModels = useMemo(() => {
    if (!deferredSearchQuery.trim()) {
      return sortedModels;
    }
    const query = deferredSearchQuery.toLowerCase().trim();
    return sortedModels.filter((model) => (
      model.model.toLowerCase().includes(query)
      || model.localModelId.toLowerCase().includes(query)
      || model.engine.toLowerCase().includes(query)
    ));
  }, [deferredSearchQuery, sortedModels]);
  const sortedInstalledArtifacts = useMemo(
    () => [...installedArtifacts].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return String(right.localArtifactId || '').localeCompare(String(left.localArtifactId || ''));
    }),
    [installedArtifacts],
  );
  const filteredInstalledArtifacts = useMemo(
    () => filterInstalledArtifacts(sortedInstalledArtifacts, artifactKindFilter, deferredSearchQuery.toLowerCase().trim()),
    [artifactKindFilter, deferredSearchQuery, sortedInstalledArtifacts],
  );
  const installedArtifactIds = useMemo(
    () => new Set(sortedInstalledArtifacts.map((artifact) => toCanonicalLocalLookupKey(artifact.artifactId)).filter(Boolean)),
    [sortedInstalledArtifacts],
  );
  const installedArtifactsById = useMemo(
    () => new Map(sortedInstalledArtifacts.map((artifact) => [toCanonicalLocalLookupKey(artifact.artifactId), artifact] as const)),
    [sortedInstalledArtifacts],
  );

  const isInstalled = useCallback((modelId: string) => {
    return sortedModels.some((model) => toCanonicalLocalLookupKey(model.model) === toCanonicalLocalLookupKey(modelId));
  }, [sortedModels]);
  const inferredCatalogCapability = useCallback((item: LocalRuntimeCatalogItemDescriptor): CapabilityOption => (
    normalizeCapabilityOption(item.capabilities.find((capability) => (
      CAPABILITY_OPTIONS.includes(capability as CapabilityOption)
    )))
  ), []);
  const selectedCatalogCapability = useCallback((item: LocalRuntimeCatalogItemDescriptor): CapabilityOption => (
    catalogCapabilityOverrides[item.itemId] || inferredCatalogCapability(item)
  ), [catalogCapabilityOverrides, inferredCatalogCapability]);
  const selectedCatalogEngine = useCallback((item: LocalRuntimeCatalogItemDescriptor): InstallEngineOption => (
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
      const rows = await localRuntime.searchCatalog({
        query,
        capability: capability === 'all' ? undefined : capability,
        limit: 30,
      });
      setCatalogItems(rows.filter((item) => !isInstalled(item.modelId)));
    } catch {
      setCatalogItems([]);
    } finally {
      setLoadingCatalog(false);
    }
  }, [isInstalled]);
  const refreshVerifiedModels = useCallback(async () => {
    setLoadingVerifiedModels(true);
    try {
      const rows = await localRuntime.listVerified();
      setVerifiedModels(sortVerifiedModelsForDisplay(rows.filter((item) => !isInstalled(item.modelId))).slice(0, 5));
    } catch {
      setVerifiedModels([]);
    } finally {
      setLoadingVerifiedModels(false);
    }
  }, [isInstalled]);
  const refreshInstalledArtifacts = useCallback(async () => {
    setLoadingInstalledArtifacts(true);
    try {
      setInstalledArtifacts(await localRuntime.listArtifacts(
        artifactKindFilter === 'all' ? undefined : { kind: artifactKindFilter },
      ));
    } catch {
      setInstalledArtifacts([]);
    } finally {
      setLoadingInstalledArtifacts(false);
    }
  }, [artifactKindFilter]);
  const refreshVerifiedArtifacts = useCallback(async () => {
    setLoadingVerifiedArtifacts(true);
    try {
      setVerifiedArtifacts(await localRuntime.listVerifiedArtifacts(
        artifactKindFilter === 'all' ? undefined : { kind: artifactKindFilter },
      ));
    } catch {
      setVerifiedArtifacts([]);
    } finally {
      setLoadingVerifiedArtifacts(false);
    }
  }, [artifactKindFilter]);
  const refreshOrphanFiles = useCallback(async () => {
    try {
      setOrphanFiles(await localRuntime.scanOrphans());
    } catch {
      setOrphanFiles([]);
    }
  }, []);
  const refreshArtifactOrphanFiles = useCallback(async () => {
    try {
      setArtifactOrphanFiles(await localRuntime.scanArtifactOrphans());
    } catch {
      setArtifactOrphanFiles([]);
    }
  }, []);
  const refreshAllOrphanFiles = useCallback(async () => {
    await Promise.all([refreshOrphanFiles(), refreshArtifactOrphanFiles()]);
  }, [refreshArtifactOrphanFiles, refreshOrphanFiles]);
  useEffect(() => {
    setCatalogDisplayCount(10);
  }, [deferredSearchQuery, catalogCapability]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshCatalogItems();
    }, 600);
    return () => clearTimeout(timer);
  }, [catalogCapability, deferredSearchQuery, refreshCatalogItems]);
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
  const visibleVerifiedArtifacts = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    const candidates = verifiedArtifacts.filter((artifact) => {
      if (installedArtifactIds.has(toCanonicalLocalLookupKey(artifact.artifactId))) {
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
    const next = new Map<string, LocalRuntimeVerifiedArtifactDescriptor[]>();
    for (const model of verifiedModels) {
      next.set(model.templateId, sortVerifiedArtifactsForDisplay(relatedArtifactsForModel(model, verifiedArtifacts)));
    }
    return next;
  }, [verifiedArtifacts, verifiedModels]);

  const verifiedArtifactsByTemplateId = useMemo(
    () => new Map(verifiedArtifacts.map((artifact) => [artifact.templateId, artifact] as const)),
    [verifiedArtifacts],
  );
  const visibleArtifactTasks = useMemo(
    () => artifactTasks.slice().sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, 4),
    [artifactTasks],
  );

  const refreshArtifactSections = useCallback(async () => {
    await Promise.all([refreshInstalledArtifacts(), refreshVerifiedArtifacts()]);
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

  const upsertArtifactTask = useCallback((templateId: string, state: ArtifactTaskState, detail?: string) => {
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
      const next = prev.filter((task) => (
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

  const installMissingArtifactsForModel = useCallback(async (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => {
    const missing = artifacts.filter((artifact) => !installedArtifactsById.has(toCanonicalLocalLookupKey(artifact.artifactId)));
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

  const importActions = useLocalModelCenterImportActions({
    artifactOrphanKinds,
    getInstallEngine: selectedCatalogEngine,
    getLatestVerifiedCapability: selectedCatalogCapability,
    isModMode,
    onRefreshAllOrphanFiles: refreshAllOrphanFiles,
    onRefreshArtifactSections: refreshArtifactSections,
    onRefreshVerifiedModels: refreshVerifiedModels,
    orphanCapabilities,
    props,
  });

  const scaffoldArtifactOrphanImport = useCallback(async (orphanPath: string) => {
    setArtifactBusy(true);
    try {
      await importActions.scaffoldArtifactOrphanImport(orphanPath);
    } catch {
      return;
    } finally {
      setArtifactBusy(false);
    }
  }, [importActions]);

  const installCatalogVariant = useCallback(async (
    item: LocalRuntimeCatalogItemDescriptor,
    variantFilename: string,
  ) => {
    importActions.closeVariantPicker();
    setInstalling(true);
    try {
      await importActions.installCatalogVariant(item, variantFilename);
    } finally {
      setInstalling(false);
    }
  }, [importActions]);

  return {
    activeDownloads: importActions.activeDownloads,
    artifactBusy,
    artifactKindFilter,
    artifactOrphanError: importActions.artifactOrphanError,
    artifactOrphanFiles,
    artifactOrphanKinds,
    artifactPendingTemplateIds,
    catalogCapability,
    catalogDisplayCount,
    catalogItems,
    closeVariantPicker: importActions.closeVariantPicker,
    deferredSearchQuery,
    filteredInstalledArtifacts,
    filteredInstalledModels,
    importArtifactManifest,
    importFileCapability,
    importMenuRef,
    installCatalogVariant,
    installMissingArtifactsForModel,
    installVerifiedArtifact,
    installVerifiedModel,
    installing,
    installedArtifactsById,
    isArtifactPending,
    loadingCatalog,
    loadingInstalledArtifacts,
    loadingVariants: importActions.loadingVariants,
    loadingVerifiedArtifacts,
    loadingVerifiedModels,
    onCancelDownload: importActions.onCancelDownload,
    onPauseDownload: importActions.onPauseDownload,
    onResumeDownload: importActions.onResumeDownload,
    orphanCapabilities,
    orphanError: importActions.orphanError,
    orphanFiles,
    orphanImportSessionByPath: importActions.orphanImportSessionByPath,
    refreshAllOrphanFiles,
    refreshArtifactSections,
    refreshVerifiedModels,
    relatedArtifactsByModelTemplate,
    removeInstalledArtifact,
    scaffoldArtifactOrphanImport,
    scaffoldOrphanImport: importActions.scaffoldOrphanImport,
    scaffoldingArtifactOrphan: importActions.scaffoldingArtifactOrphan,
    scaffoldingOrphan: importActions.scaffoldingOrphan,
    searchQuery,
    selectedCatalogCapability,
    selectedCatalogEngine,
    setArtifactKindFilter,
    setArtifactOrphanKinds,
    setCatalogCapability,
    setCatalogCapabilityOverrides,
    setCatalogDisplayCount,
    setCatalogEngineOverrides,
    setImportFileCapability,
    setOrphanCapabilities,
    setSearchQuery,
    setShowImportFileDialog,
    setShowImportMenu,
    showImportFileDialog,
    showImportMenu,
    toggleVariantPicker: importActions.toggleVariantPicker,
    variantError: importActions.variantError,
    variantList: importActions.variantList,
    variantPickerItem: importActions.variantPickerItem,
    verifiedModels,
    visibleArtifactTasks,
    visibleVerifiedArtifacts,
  };
}
