import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeAssetDeclaration,
  type LocalRuntimeAssetKind,
  type LocalRuntimeAssetRecord,
  type LocalRuntimeCatalogItemDescriptor,
  type LocalRuntimeUnregisteredAssetDescriptor,
  type LocalRuntimeVerifiedAssetDescriptor,
} from '@runtime/local-runtime';
import {
  defaultAssetDeclaration,
  normalizeCapabilityOption,
  normalizeInstallEngine,
  normalizeModelTypeOption,
  CAPABILITY_OPTIONS,
  PROGRESS_RETENTION_MS,
  type AssetClassOption,
  type AssetEngineOption,
  type CapabilityOption,
  type InstallEngineOption,
  type LocalModelCenterProps,
  type ModelTypeOption,
  parseTimestamp,
} from './runtime-config-model-center-utils';
import {
  ASSET_KIND_OPTIONS,
  filterInstalledAssets,
  isAssetTaskTerminal,
  relatedPassiveAssetsForRunnable,
  sortVerifiedAssetsForDisplay,
  type AssetTaskEntry,
  type AssetTaskState,
} from './runtime-config-local-model-center-helpers';
import { toCanonicalLocalLookupKey } from '@runtime/local-runtime/local-id';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useLocalModelCenterImportActions } from './runtime-config-use-local-model-center-import-actions';

type UseLocalModelCenterRuntimeStateInput = {
  isModMode: boolean;
  props: LocalModelCenterProps;
};

function defaultEngineForModelType(modelType: ModelTypeOption): AssetEngineOption {
  if (modelType === 'image' || modelType === 'video') {
    return 'media';
  }
  if (modelType === 'tts' || modelType === 'stt') {
    return 'speech';
  }
  if (modelType === 'music') {
    return 'sidecar';
  }
  return 'llama';
}

function defaultEngineForArtifactKind(kind: LocalRuntimeAssetKind): AssetEngineOption | '' {
  if (kind === 'auxiliary') {
    return '';
  }
  return 'media';
}

function normalizeArtifactKind(kind: string | undefined): LocalRuntimeAssetKind {
  const normalized = String(kind || '').trim().toLowerCase();
  return (ASSET_KIND_OPTIONS.find((value) => value === normalized) || 'vae') as LocalRuntimeAssetKind;
}

const RUNNABLE_ASSET_KINDS = new Set(['chat', 'image', 'video', 'tts', 'stt']);

function normalizeAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclaration,
): LocalRuntimeAssetDeclaration {
  const assetKind = declaration?.assetKind;
  const isRunnable = RUNNABLE_ASSET_KINDS.has(String(assetKind || ''));
  if (!isRunnable && assetKind) {
    const normalizedKind = normalizeArtifactKind(assetKind);
    const engine = String(declaration?.engine || '').trim();
    return {
      assetKind: normalizedKind,
      ...(engine ? { engine } : (normalizedKind === 'auxiliary' ? {} : { engine: defaultEngineForArtifactKind(normalizedKind) })),
    };
  }

  const modelType = normalizeModelTypeOption(assetKind);
  return {
    assetKind: modelType === 'music' ? 'chat' : modelType as LocalRuntimeAssetKind,
    engine: String(declaration?.engine || '').trim() || defaultEngineForModelType(modelType),
  };
}

function canImportDeclaration(declaration: LocalRuntimeAssetDeclaration): boolean {
  const assetKind = declaration.assetKind;
  if (!assetKind) {
    return false;
  }
  if (assetKind === 'auxiliary') {
    return Boolean(String(declaration.engine || '').trim());
  }
  return true;
}

export function useLocalModelCenterRuntimeState({ isModMode, props }: UseLocalModelCenterRuntimeStateInput) {
  const [installing, setInstalling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<LocalRuntimeCatalogItemDescriptor[]>([]);
  const [catalogDisplayCount, setCatalogDisplayCount] = useState(10);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [verifiedModels, setVerifiedModels] = useState<LocalRuntimeVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [installedArtifacts, setInstalledArtifacts] = useState<LocalRuntimeAssetRecord[]>([]);
  const [loadingInstalledArtifacts, setLoadingInstalledArtifacts] = useState(false);
  const [verifiedArtifacts, setVerifiedArtifacts] = useState<LocalRuntimeVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedArtifacts, setLoadingVerifiedArtifacts] = useState(false);
  const [artifactKindFilter, setArtifactKindFilter] = useState<'all' | LocalRuntimeAssetKind>('all');
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactPendingTemplateIds, setArtifactPendingTemplateIds] = useState<string[]>([]);
  const [artifactTasks, setArtifactTasks] = useState<AssetTaskEntry[]>([]);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);
  const [importFileAssetClass, setImportFileAssetClass] = useState<AssetClassOption>('model');
  const [importFileModelType, setImportFileModelType] = useState<ModelTypeOption>('chat');
  const [importFileArtifactKind, setImportFileArtifactKind] = useState<LocalRuntimeAssetKind>('vae');
  const [importFileAuxiliaryEngine, setImportFileAuxiliaryEngine] = useState<AssetEngineOption | ''>('');
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});
  const [catalogEngineOverrides, setCatalogEngineOverrides] = useState<Record<string, InstallEngineOption>>({});
  const [unregisteredAssets, setUnregisteredAssets] = useState<LocalRuntimeUnregisteredAssetDescriptor[]>([]);
  const [unregisteredAssetDrafts, setUnregisteredAssetDrafts] = useState<Record<string, LocalRuntimeAssetDeclaration>>({});
  const autoImportAttemptedPathsRef = useRef<Set<string>>(new Set());

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
      return String(right.localAssetId || '').localeCompare(String(left.localAssetId || ''));
    }),
    [installedArtifacts],
  );

  const filteredInstalledArtifacts = useMemo(
    () => filterInstalledAssets(sortedInstalledArtifacts, artifactKindFilter, deferredSearchQuery.toLowerCase().trim()),
    [artifactKindFilter, deferredSearchQuery, sortedInstalledArtifacts],
  );

  const installedArtifactIds = useMemo(
    () => new Set(sortedInstalledArtifacts.map((artifact) => toCanonicalLocalLookupKey(artifact.assetId)).filter(Boolean)),
    [sortedInstalledArtifacts],
  );

  const installedArtifactsById = useMemo(
    () => new Map(sortedInstalledArtifacts.map((artifact) => [toCanonicalLocalLookupKey(artifact.assetId), artifact] as const)),
    [sortedInstalledArtifacts],
  );

  const isInstalled = useCallback((modelId: string) => (
    sortedModels.some((model) => toCanonicalLocalLookupKey(model.model) === toCanonicalLocalLookupKey(modelId))
  ), [sortedModels]);

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
  const catalogRequestSeqRef = useRef(0);
  const verifiedModelsRequestSeqRef = useRef(0);
  const installedArtifactsRequestSeqRef = useRef(0);
  const verifiedArtifactsRequestSeqRef = useRef(0);
  const unregisteredAssetsRequestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshCatalogItems = useCallback(async () => {
    const requestId = ++catalogRequestSeqRef.current;
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
      if (!mountedRef.current || requestId !== catalogRequestSeqRef.current) {
        return;
      }
      setCatalogItems(rows.filter((item) => !isInstalled(item.modelId)));
    } catch {
      if (!mountedRef.current || requestId !== catalogRequestSeqRef.current) {
        return;
      }
      setCatalogItems([]);
    } finally {
      if (mountedRef.current && requestId === catalogRequestSeqRef.current) {
        setLoadingCatalog(false);
      }
    }
  }, [isInstalled]);

  const refreshVerifiedModels = useCallback(async () => {
    const requestId = ++verifiedModelsRequestSeqRef.current;
    setLoadingVerifiedModels(true);
    try {
      const rows = await localRuntime.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setVerifiedModels(sortVerifiedAssetsForDisplay(rows.filter((item) => !isInstalled(item.assetId))).slice(0, 5));
    } catch {
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setVerifiedModels([]);
    } finally {
      if (mountedRef.current && requestId === verifiedModelsRequestSeqRef.current) {
        setLoadingVerifiedModels(false);
      }
    }
  }, [isInstalled]);

  const refreshInstalledArtifacts = useCallback(async () => {
    const requestId = ++installedArtifactsRequestSeqRef.current;
    setLoadingInstalledArtifacts(true);
    try {
      const rows = await localRuntime.listAssets(
        artifactKindFilter === 'all' ? undefined : { kind: artifactKindFilter },
      );
      if (!mountedRef.current || requestId !== installedArtifactsRequestSeqRef.current) {
        return;
      }
      setInstalledArtifacts(rows);
    } catch {
      if (!mountedRef.current || requestId !== installedArtifactsRequestSeqRef.current) {
        return;
      }
      setInstalledArtifacts([]);
    } finally {
      if (mountedRef.current && requestId === installedArtifactsRequestSeqRef.current) {
        setLoadingInstalledArtifacts(false);
      }
    }
  }, [artifactKindFilter]);

  const refreshVerifiedArtifacts = useCallback(async () => {
    const requestId = ++verifiedArtifactsRequestSeqRef.current;
    setLoadingVerifiedArtifacts(true);
    try {
      const rows = await localRuntime.listVerifiedAssets(
        artifactKindFilter === 'all' ? undefined : { kind: artifactKindFilter },
      );
      if (!mountedRef.current || requestId !== verifiedArtifactsRequestSeqRef.current) {
        return;
      }
      setVerifiedArtifacts(rows);
    } catch {
      if (!mountedRef.current || requestId !== verifiedArtifactsRequestSeqRef.current) {
        return;
      }
      setVerifiedArtifacts([]);
    } finally {
      if (mountedRef.current && requestId === verifiedArtifactsRequestSeqRef.current) {
        setLoadingVerifiedArtifacts(false);
      }
    }
  }, [artifactKindFilter]);

  const refreshUnregisteredAssets = useCallback(async () => {
    const requestId = ++unregisteredAssetsRequestSeqRef.current;
    try {
      const rows = await localRuntime.scanUnregisteredAssets();
      if (!mountedRef.current || requestId !== unregisteredAssetsRequestSeqRef.current) {
        return;
      }
      setUnregisteredAssets(rows);
      setUnregisteredAssetDrafts((prev) => {
        const next: Record<string, LocalRuntimeAssetDeclaration> = {};
        for (const item of rows) {
          const existing = prev[item.path];
          if (existing) {
            next[item.path] = existing;
            continue;
          }
          if (item.declaration) {
            next[item.path] = normalizeAssetDeclaration(item.declaration);
          }
        }
        return next;
      });
    } catch {
      if (!mountedRef.current || requestId !== unregisteredAssetsRequestSeqRef.current) {
        return;
      }
      setUnregisteredAssets([]);
      setUnregisteredAssetDrafts({});
    }
  }, []);

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
    void refreshUnregisteredAssets();
  }, [refreshUnregisteredAssets]);

  const visibleVerifiedArtifacts = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    const candidates = verifiedArtifacts.filter((artifact) => {
      if (installedArtifactIds.has(toCanonicalLocalLookupKey(artifact.assetId))) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        artifact.assetId.toLowerCase().includes(query)
        || artifact.title.toLowerCase().includes(query)
        || artifact.description.toLowerCase().includes(query)
        || artifact.kind.toLowerCase().includes(query)
        || artifact.repo.toLowerCase().includes(query)
      );
    });
    return sortVerifiedAssetsForDisplay(candidates);
  }, [deferredSearchQuery, installedArtifactIds, verifiedArtifacts]);

  const relatedArtifactsByModelTemplate = useMemo(() => {
    const next = new Map<string, LocalRuntimeVerifiedAssetDescriptor[]>();
    for (const model of verifiedModels) {
      next.set(model.templateId, sortVerifiedAssetsForDisplay(relatedPassiveAssetsForRunnable(model, verifiedArtifacts)));
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

  const upsertArtifactTask = useCallback((templateId: string, state: AssetTaskState, detail?: string) => {
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
        && !(isAssetTaskTerminal(task.state) && nowMs - task.updatedAtMs > PROGRESS_RETENTION_MS)
      ));
      next.unshift({
        templateId: normalizedTemplateId,
        assetId: descriptor.assetId,
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

  const installMissingArtifactsForModel = useCallback(async (artifacts: LocalRuntimeVerifiedAssetDescriptor[]) => {
    const missing = artifacts.filter((artifact) => !installedArtifactsById.has(toCanonicalLocalLookupKey(artifact.assetId)));
    for (const artifact of missing) {
      await installVerifiedArtifact(artifact.templateId);
    }
  }, [installVerifiedArtifact, installedArtifactsById]);

  const removeInstalledArtifact = useCallback(async (localArtifactId: string) => {
    setArtifactBusy(true);
    try {
      await props.onRemoveArtifact(localArtifactId);
    } catch {
      // Error is already surfaced as a status banner by the panel controller.
    }
    try {
      await refreshArtifactSections();
      await refreshUnregisteredAssets();
    } finally {
      setArtifactBusy(false);
    }
  }, [props, refreshArtifactSections, refreshUnregisteredAssets]);

  const installVerifiedModel = useCallback(async (templateId: string) => {
    setInstalling(true);
    try {
      await props.onInstallVerified(templateId);
    } finally {
      setInstalling(false);
    }
  }, [props]);

  const importActions = useLocalModelCenterImportActions({
    getInstallEngine: selectedCatalogEngine,
    isModMode,
    onRefreshUnregisteredAssets: refreshUnregisteredAssets,
    onRefreshArtifactSections: refreshArtifactSections,
    onRefreshVerifiedModels: refreshVerifiedModels,
    props,
  });

  const resolveUnregisteredAssetDraft = useCallback((asset: LocalRuntimeUnregisteredAssetDescriptor): LocalRuntimeAssetDeclaration => (
    unregisteredAssetDrafts[asset.path]
    || normalizeAssetDeclaration(asset.declaration)
    || defaultAssetDeclaration('model')
  ), [unregisteredAssetDrafts]);

  const setUnregisteredAssetDraft = useCallback((
    assetPath: string,
    nextDeclaration: LocalRuntimeAssetDeclaration,
  ) => {
    setUnregisteredAssetDrafts((prev) => ({
      ...prev,
      [assetPath]: nextDeclaration,
    }));
  }, []);

  const setUnregisteredAssetClass = useCallback((assetPath: string, assetClass: AssetClassOption) => {
    setUnregisteredAssetDraft(assetPath, defaultAssetDeclaration(assetClass));
  }, [setUnregisteredAssetDraft]);

  const setUnregisteredModelType = useCallback((assetPath: string, modelType: ModelTypeOption) => {
    setUnregisteredAssetDraft(assetPath, {
      assetKind: modelType === 'music' ? 'chat' : modelType as LocalRuntimeAssetKind,
      engine: defaultEngineForModelType(modelType),
    });
  }, [setUnregisteredAssetDraft]);

  const setUnregisteredArtifactKind = useCallback((assetPath: string, artifactKind: LocalRuntimeAssetKind) => {
    const engine = defaultEngineForArtifactKind(artifactKind);
    setUnregisteredAssetDraft(assetPath, {
      assetKind: artifactKind,
      ...(engine ? { engine } : {}),
    });
  }, [setUnregisteredAssetDraft]);

  const setUnregisteredAuxiliaryEngine = useCallback((assetPath: string, engine: AssetEngineOption | '') => {
    setUnregisteredAssetDrafts((prev) => {
      const current = normalizeAssetDeclaration(prev[assetPath] || {
        assetKind: 'auxiliary',
      });
      return {
        ...prev,
        [assetPath]: {
          ...current,
          assetKind: 'auxiliary',
          ...(engine ? { engine } : {}),
        },
      };
    });
  }, []);

  const importUnregisteredAsset = useCallback(async (assetPath: string) => {
    const asset = unregisteredAssets.find((item) => item.path === assetPath);
    if (!asset) {
      return;
    }
    const declaration = resolveUnregisteredAssetDraft(asset);
    if (!canImportDeclaration(declaration)) {
      return;
    }
    await importActions.importAssetFromPath(assetPath, declaration);
  }, [importActions, resolveUnregisteredAssetDraft, unregisteredAssets]);

  const scheduleAutoImportAttempt = useCallback((assetPath: string, declaration: LocalRuntimeAssetDeclaration) => {
    void importActions.importAssetFromPath(assetPath, declaration).catch((error) => {
      logRendererEvent({
        level: 'error',
        area: 'runtime-config-local-model-center',
        message: 'phase:auto-import:failed',
        details: {
          assetPath,
          error: error instanceof Error ? error.message : String(error || 'unknown error'),
        },
      });
    });
  }, [importActions]);

  useEffect(() => {
    const currentPaths = new Set(unregisteredAssets.map((asset) => asset.path));
    for (const path of autoImportAttemptedPathsRef.current) {
      if (!currentPaths.has(path)) {
        autoImportAttemptedPathsRef.current.delete(path);
      }
    }
  }, [unregisteredAssets]);

  useEffect(() => {
    for (const asset of unregisteredAssets) {
      const draft = resolveUnregisteredAssetDraft(asset);
      if (!asset.autoImportable || !canImportDeclaration(draft)) {
        continue;
      }
      if (autoImportAttemptedPathsRef.current.has(asset.path)) {
        continue;
      }
      autoImportAttemptedPathsRef.current.add(asset.path);
      scheduleAutoImportAttempt(asset.path, draft);
    }
  }, [resolveUnregisteredAssetDraft, scheduleAutoImportAttempt, unregisteredAssets]);

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

  const importFileDeclaration = useMemo<LocalRuntimeAssetDeclaration>(() => {
    if (importFileAssetClass === 'artifact') {
      const engine = importFileArtifactKind === 'auxiliary'
        ? String(importFileAuxiliaryEngine || '').trim()
        : defaultEngineForArtifactKind(importFileArtifactKind);
      return {
        assetKind: importFileArtifactKind,
        ...(engine ? { engine } : {}),
      };
    }
    return {
      assetKind: importFileModelType === 'music' ? 'chat' as const : importFileModelType as LocalRuntimeAssetKind,
      engine: defaultEngineForModelType(importFileModelType),
    };
  }, [importFileArtifactKind, importFileAssetClass, importFileAuxiliaryEngine, importFileModelType]);

  return {
    activeDownloads: importActions.activeDownloads,
    activeImports: importActions.activeImports,
    artifactBusy,
    artifactKindFilter,
    artifactOrphanError: '',
    artifactOrphanFiles: [],
    artifactOrphanKinds: {},
    artifactPendingTemplateIds,
    assetImportError: importActions.assetImportError,
    assetImportSessionByPath: importActions.assetImportSessionByPath,
    catalogCapability,
    catalogDisplayCount,
    catalogItems,
    closeVariantPicker: importActions.closeVariantPicker,
    deferredSearchQuery,
    filteredInstalledArtifacts,
    filteredInstalledModels,
    importFileArtifactKind,
    importFileAssetClass,
    importFileAuxiliaryEngine,
    importFileDeclaration,
    importFileModelType,
    importMenuRef,
    importingAssetPath: importActions.importingAssetPath,
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
    onDismissSession: importActions.onDismissSession,
    onPauseDownload: importActions.onPauseDownload,
    onResumeDownload: importActions.onResumeDownload,
    orphanCapabilities: {},
    orphanError: '',
    orphanFiles: [],
    orphanImportSessionByPath: {},
    refreshArtifactSections,
    refreshUnregisteredAssets,
    refreshVerifiedModels,
    relatedArtifactsByModelTemplate,
    removeInstalledArtifact,
    resolveUnregisteredAssetDraft,
    searchQuery,
    selectedCatalogCapability,
    selectedCatalogEngine,
    setArtifactKindFilter,
    setCatalogCapability,
    setCatalogCapabilityOverrides,
    setCatalogDisplayCount,
    setCatalogEngineOverrides,
    setImportFileArtifactKind,
    setImportFileAssetClass,
    setImportFileAuxiliaryEngine,
    setImportFileModelType,
    setSearchQuery,
    setShowImportFileDialog,
    setShowImportMenu,
    setUnregisteredArtifactKind,
    setUnregisteredAssetClass,
    setUnregisteredAuxiliaryEngine,
    setUnregisteredModelType,
    showImportFileDialog,
    showImportMenu,
    canChooseImportFile: canImportDeclaration(importFileDeclaration),
    toggleVariantPicker: importActions.toggleVariantPicker,
    unregisteredAssetDrafts,
    unregisteredAssets,
    importPickedAssetFile: importActions.importPickedAssetFile,
    importPickedAssetManifest: importActions.importPickedAssetManifest,
    importUnregisteredAsset,
    variantError: importActions.variantError,
    variantList: importActions.variantList,
    variantPickerItem: importActions.variantPickerItem,
    verifiedModels,
    visibleArtifactTasks,
    visibleVerifiedArtifacts,
  };
}
