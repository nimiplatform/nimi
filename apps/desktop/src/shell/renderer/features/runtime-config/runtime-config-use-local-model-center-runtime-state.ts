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
  basenameFromRuntimePath,
  planBlocksCanonicalImageImport,
  defaultAssetDeclaration,
  normalizeCapabilityOption,
  normalizeInstallEngine,
  CAPABILITY_OPTIONS,
  PROGRESS_RETENTION_MS,
  planBlockingHint,
  planRequiresAttachedEndpointInput,
  type AssetEngineOption,
  type CapabilityOption,
  type InstallEngineOption,
  type LocalModelCenterProps,
  parseTimestamp,
} from './runtime-config-model-center-utils';
import {
  filterInstalledAssets,
  isAssetTaskTerminal,
  relatedPassiveAssetsForRunnable,
  sortVerifiedAssetsForDisplay,
  type AssetTaskEntry,
  type AssetTaskState,
} from './runtime-config-local-model-center-helpers';
import {
  canImportDeclaration,
  capabilitiesForAssetKind,
  defaultEngineForAnyAssetKind,
  manifestPathFromSourceRepo,
  normalizeAssetDeclaration,
  RUNNABLE_ASSET_KINDS,
} from './runtime-config-use-local-model-center-helpers.js';
import {
  planAttachedEndpointHint,
  useLocalModelCenterImportFilePlan,
} from './runtime-config-use-local-model-center-import-file-plan';
import { toCanonicalLocalLookupKey } from '@runtime/local-runtime/local-id';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
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
  const [verifiedModels, setVerifiedModels] = useState<LocalRuntimeVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [installedAssets, setInstalledAssets] = useState<LocalRuntimeAssetRecord[]>([]);
  const [loadingInstalledAssets, setLoadingInstalledAssets] = useState(false);
  const [verifiedAssets, setVerifiedAssets] = useState<LocalRuntimeVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedAssets, setLoadingVerifiedAssets] = useState(false);
  const [assetKindFilter, setAssetKindFilter] = useState<'all' | LocalRuntimeAssetKind>('all');
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetPendingTemplateIds, setAssetPendingTemplateIds] = useState<string[]>([]);
  const [assetTasks, setAssetTasks] = useState<AssetTaskEntry[]>([]);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);
  const [importFileAssetKind, setImportFileAssetKind] = useState<LocalRuntimeAssetKind>('chat');
  const [importFileAuxiliaryEngine, setImportFileAuxiliaryEngine] = useState<AssetEngineOption | ''>('');
  const [importFileEndpoint, setImportFileEndpoint] = useState('');
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});
  const [catalogEngineOverrides, setCatalogEngineOverrides] = useState<Record<string, InstallEngineOption>>({});
  const [unregisteredAssets, setUnregisteredAssets] = useState<LocalRuntimeUnregisteredAssetDescriptor[]>([]);
  const [unregisteredAssetDrafts, setUnregisteredAssetDrafts] = useState<Record<string, LocalRuntimeAssetDeclaration>>({});
  const [unregisteredEndpointByPath, setUnregisteredEndpointByPath] = useState<Record<string, string>>({});
  const [unregisteredEndpointRequiredByPath, setUnregisteredEndpointRequiredByPath] = useState<Record<string, boolean>>({});
  const [unregisteredEndpointHintByPath, setUnregisteredEndpointHintByPath] = useState<Record<string, string>>({});
  const [unregisteredCompatibilityHintByPath, setUnregisteredCompatibilityHintByPath] = useState<Record<string, string>>({});
  const [unregisteredImportAllowedByPath, setUnregisteredImportAllowedByPath] = useState<Record<string, boolean>>({});
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

  const sortedInstalledAssets = useMemo(
    () => [...installedAssets].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return String(right.localAssetId || '').localeCompare(String(left.localAssetId || ''));
    }),
    [installedAssets],
  );

  const visibleInstalledAssets = useMemo(
    () => sortedInstalledAssets.filter((asset) => asset.status !== 'removed'),
    [sortedInstalledAssets],
  );

  const sortedInstalledRunnableAssets = useMemo(
    () => visibleInstalledAssets.filter((asset) => RUNNABLE_ASSET_KINDS.has(asset.kind)),
    [visibleInstalledAssets],
  );

  const filteredInstalledRunnableAssets = useMemo(() => {
    if (!deferredSearchQuery.trim()) {
      return sortedInstalledRunnableAssets;
    }
    const query = deferredSearchQuery.toLowerCase().trim();
    return sortedInstalledRunnableAssets.filter((asset) => (
      asset.assetId.toLowerCase().includes(query)
      || asset.localAssetId.toLowerCase().includes(query)
      || asset.engine.toLowerCase().includes(query)
      || asset.kind.toLowerCase().includes(query)
      || asset.logicalModelId?.toLowerCase().includes(query)
      || asset.source.repo.toLowerCase().includes(query)
      || (asset.capabilities || []).some((capability) => capability.toLowerCase().includes(query))
    ));
  }, [deferredSearchQuery, sortedInstalledRunnableAssets]);

  const sortedInstalledDependencyAssets = useMemo(
    () => visibleInstalledAssets.filter((asset) => !RUNNABLE_ASSET_KINDS.has(asset.kind)),
    [visibleInstalledAssets],
  );

  const filteredInstalledDependencyAssets = useMemo(
    () => filterInstalledAssets(sortedInstalledDependencyAssets, assetKindFilter, deferredSearchQuery.toLowerCase().trim()),
    [assetKindFilter, deferredSearchQuery, sortedInstalledDependencyAssets],
  );

  const installedRunnableAssetIds = useMemo(
    () => new Set(sortedInstalledRunnableAssets.map((asset) => toCanonicalLocalLookupKey(asset.assetId)).filter(Boolean)),
    [sortedInstalledRunnableAssets],
  );

  const installedAssetsById = useMemo(
    () => new Map(visibleInstalledAssets.map((asset) => [toCanonicalLocalLookupKey(asset.assetId), asset] as const)),
    [visibleInstalledAssets],
  );

  const isRunnableAssetInstalled = useCallback((assetId: string) => (
    installedRunnableAssetIds.has(toCanonicalLocalLookupKey(assetId))
  ), [installedRunnableAssetIds]);

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
  const installedAssetsRequestSeqRef = useRef(0);
  const verifiedAssetsRequestSeqRef = useRef(0);
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
      setCatalogItems(rows.filter((item) => !isRunnableAssetInstalled(item.modelId)));
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
  }, [isRunnableAssetInstalled]);

  const refreshVerifiedModels = useCallback(async () => {
    const requestId = ++verifiedModelsRequestSeqRef.current;
    setLoadingVerifiedModels(true);
    try {
      const rows = await localRuntime.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setVerifiedModels(sortVerifiedAssetsForDisplay(rows.filter((item) => (
        RUNNABLE_ASSET_KINDS.has(item.kind) && !isRunnableAssetInstalled(item.assetId)
      ))).slice(0, 5));
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
  }, [isRunnableAssetInstalled]);

  const refreshInstalledAssets = useCallback(async () => {
    const requestId = ++installedAssetsRequestSeqRef.current;
    setLoadingInstalledAssets(true);
    try {
      const rows = await localRuntime.listAssets();
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) {
        return;
      }
      setInstalledAssets(rows);
    } catch {
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) {
        return;
      }
      setInstalledAssets([]);
    } finally {
      if (mountedRef.current && requestId === installedAssetsRequestSeqRef.current) {
        setLoadingInstalledAssets(false);
      }
    }
  }, []);

  const refreshVerifiedAssets = useCallback(async () => {
    const requestId = ++verifiedAssetsRequestSeqRef.current;
    setLoadingVerifiedAssets(true);
    try {
      const rows = await localRuntime.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedAssetsRequestSeqRef.current) {
        return;
      }
      setVerifiedAssets(rows);
    } catch {
      if (!mountedRef.current || requestId !== verifiedAssetsRequestSeqRef.current) {
        return;
      }
      setVerifiedAssets([]);
    } finally {
      if (mountedRef.current && requestId === verifiedAssetsRequestSeqRef.current) {
        setLoadingVerifiedAssets(false);
      }
    }
  }, []);

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
    void refreshInstalledAssets();
  }, [refreshInstalledAssets]);

  useEffect(() => {
    void refreshVerifiedAssets();
  }, [refreshVerifiedAssets]);

  useEffect(() => {
    void refreshUnregisteredAssets();
  }, [refreshUnregisteredAssets]);

  const visibleVerifiedAssets = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    const candidates = verifiedAssets.filter((asset) => {
      if (RUNNABLE_ASSET_KINDS.has(asset.kind)) {
        return false;
      }
      if (assetKindFilter !== 'all' && asset.kind !== assetKindFilter) {
        return false;
      }
      if (installedAssetsById.has(toCanonicalLocalLookupKey(asset.assetId))) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        asset.assetId.toLowerCase().includes(query)
        || asset.title.toLowerCase().includes(query)
        || asset.description.toLowerCase().includes(query)
        || asset.kind.toLowerCase().includes(query)
        || asset.repo.toLowerCase().includes(query)
      );
    });
    return sortVerifiedAssetsForDisplay(candidates);
  }, [assetKindFilter, deferredSearchQuery, installedAssetsById, verifiedAssets]);

  const relatedAssetsByModelTemplate = useMemo(() => {
    const next = new Map<string, LocalRuntimeVerifiedAssetDescriptor[]>();
    for (const model of verifiedModels) {
      next.set(model.templateId, sortVerifiedAssetsForDisplay(relatedPassiveAssetsForRunnable(model, verifiedAssets)));
    }
    return next;
  }, [verifiedAssets, verifiedModels]);

  const verifiedAssetsByTemplateId = useMemo(
    () => new Map(verifiedAssets.map((asset) => [asset.templateId, asset] as const)),
    [verifiedAssets],
  );

  const visibleAssetTasks = useMemo(
    () => assetTasks.slice().sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, 4),
    [assetTasks],
  );

  const refreshAssetSections = useCallback(async () => {
    await Promise.all([refreshInstalledAssets(), refreshVerifiedAssets()]);
  }, [refreshInstalledAssets, refreshVerifiedAssets]);

  const markAssetPending = useCallback((templateId: string, pending: boolean) => {
    const normalized = String(templateId || '').trim();
    if (!normalized) {
      return;
    }
    setAssetPendingTemplateIds((prev) => {
      if (pending) {
        return prev.includes(normalized) ? prev : [...prev, normalized];
      }
      return prev.filter((item) => item !== normalized);
    });
  }, []);

  const upsertAssetTask = useCallback((templateId: string, state: AssetTaskState, detail?: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return;
    }
    const descriptor = verifiedAssetsByTemplateId.get(normalizedTemplateId);
    if (!descriptor) {
      return;
    }
    const nowMs = Date.now();
    setAssetTasks((prev) => {
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
  }, [verifiedAssetsByTemplateId]);

  const isAssetPending = useCallback((templateId: string) => (
    assetPendingTemplateIds.includes(String(templateId || '').trim())
  ), [assetPendingTemplateIds]);

  const installVerifiedAsset = useCallback(async (templateId: string) => {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return;
    }
    markAssetPending(normalizedTemplateId, true);
    upsertAssetTask(normalizedTemplateId, 'running');
    try {
      await props.onInstallVerifiedAsset(normalizedTemplateId);
      await refreshAssetSections();
      upsertAssetTask(normalizedTemplateId, 'completed', 'Asset installed and ready.');
    } catch (error: unknown) {
      upsertAssetTask(
        normalizedTemplateId,
        'failed',
        error instanceof Error ? error.message : String(error || 'Asset install failed'),
      );
      throw error;
    } finally {
      markAssetPending(normalizedTemplateId, false);
    }
  }, [markAssetPending, props, refreshAssetSections, upsertAssetTask]);

  const installMissingAssetsForModel = useCallback(async (assets: LocalRuntimeVerifiedAssetDescriptor[]) => {
    const missing = assets.filter((asset) => !installedAssetsById.has(toCanonicalLocalLookupKey(asset.assetId)));
    for (const asset of missing) {
      await installVerifiedAsset(asset.templateId);
    }
  }, [installVerifiedAsset, installedAssetsById]);

  const removeInstalledAsset = useCallback(async (localAssetId: string) => {
    setAssetBusy(true);
    try {
      await props.onRemoveAsset(localAssetId);
    } catch {
      // Error is already surfaced as a status banner by the panel controller.
    }
    try {
      await refreshAssetSections();
      await refreshUnregisteredAssets();
    } finally {
      setAssetBusy(false);
    }
  }, [props, refreshAssetSections, refreshUnregisteredAssets]);

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
    onRefreshAssetSections: refreshAssetSections,
    onRefreshVerifiedModels: refreshVerifiedModels,
    props,
  });

  const resolveUnregisteredAssetDraft = useCallback((asset: LocalRuntimeUnregisteredAssetDescriptor): LocalRuntimeAssetDeclaration => (
    unregisteredAssetDrafts[asset.path]
    || normalizeAssetDeclaration(asset.declaration)
    || defaultAssetDeclaration('runnable')
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

  const setUnregisteredAssetKind = useCallback((assetPath: string, assetKind: LocalRuntimeAssetKind) => {
    const engine = defaultEngineForAnyAssetKind(assetKind);
    setUnregisteredAssetDraft(assetPath, {
      assetKind,
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

  const setUnregisteredEndpoint = useCallback((assetPath: string, endpoint: string) => {
    setUnregisteredEndpointByPath((prev) => ({
      ...prev,
      [assetPath]: endpoint,
    }));
  }, []);

  useEffect(() => {
    const currentPaths = new Set(unregisteredAssets.map((asset) => asset.path));
    setUnregisteredEndpointByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredEndpointRequiredByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredEndpointHintByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredCompatibilityHintByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
    setUnregisteredImportAllowedByPath((prev) => Object.fromEntries(
      Object.entries(prev).filter(([path]) => currentPaths.has(path)),
    ));
  }, [unregisteredAssets]);

  useEffect(() => {
    let cancelled = false;
    for (const asset of unregisteredAssets) {
      const declaration = resolveUnregisteredAssetDraft(asset);
      if (declaration.assetKind === 'auxiliary') {
        continue;
      }
      const engine = String(declaration.engine || '').trim();
      if (engine !== 'media' && engine !== 'speech') {
        setUnregisteredEndpointRequiredByPath((prev) => ({ ...prev, [asset.path]: false }));
        setUnregisteredEndpointHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
        setUnregisteredCompatibilityHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
        setUnregisteredImportAllowedByPath((prev) => ({ ...prev, [asset.path]: true }));
        continue;
      }
      const previewFileName = basenameFromRuntimePath(asset.path);
      setUnregisteredImportAllowedByPath((prev) => ({ ...prev, [asset.path]: false }));
      void localRuntime.resolveInstallPlan({
        modelId: `local-import/unregistered-preview-${declaration.assetKind}`,
        capabilities: capabilitiesForAssetKind(declaration.assetKind),
        engine,
        entry: previewFileName,
        files: [previewFileName],
      }).then((plan) => {
        if (cancelled) {
          return;
        }
        const required = planRequiresAttachedEndpointInput(plan);
        const blocked = planBlocksCanonicalImageImport(plan);
        setUnregisteredEndpointRequiredByPath((prev) => ({ ...prev, [asset.path]: required }));
        setUnregisteredEndpointHintByPath((prev) => ({
          ...prev,
          [asset.path]: required ? planAttachedEndpointHint(plan) : '',
        }));
        setUnregisteredCompatibilityHintByPath((prev) => ({
          ...prev,
          [asset.path]: blocked ? planBlockingHint(plan) : '',
        }));
        setUnregisteredImportAllowedByPath((prev) => ({ ...prev, [asset.path]: !blocked }));
      }).catch(() => {
        if (cancelled) {
          return;
        }
        setUnregisteredEndpointRequiredByPath((prev) => ({ ...prev, [asset.path]: false }));
        setUnregisteredEndpointHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
        setUnregisteredCompatibilityHintByPath((prev) => ({ ...prev, [asset.path]: '' }));
        setUnregisteredImportAllowedByPath((prev) => ({ ...prev, [asset.path]: true }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [resolveUnregisteredAssetDraft, unregisteredAssets]);

  const importUnregisteredAsset = useCallback(async (assetPath: string) => {
    const asset = unregisteredAssets.find((item) => item.path === assetPath);
    if (!asset) {
      return;
    }
    const declaration = resolveUnregisteredAssetDraft(asset);
    if (!canImportDeclaration(declaration) || unregisteredImportAllowedByPath[assetPath] === false) {
      return;
    }
    await importActions.importAssetFromPath(
      assetPath,
      declaration,
      String(unregisteredEndpointByPath[assetPath] || '').trim() || undefined,
    );
  }, [importActions, resolveUnregisteredAssetDraft, unregisteredAssets, unregisteredEndpointByPath, unregisteredImportAllowedByPath]);

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
      if (!asset.autoImportable || !canImportDeclaration(draft) || unregisteredImportAllowedByPath[asset.path] === false) {
        continue;
      }
      if (autoImportAttemptedPathsRef.current.has(asset.path)) {
        continue;
      }
      autoImportAttemptedPathsRef.current.add(asset.path);
      scheduleAutoImportAttempt(asset.path, draft);
    }
  }, [resolveUnregisteredAssetDraft, scheduleAutoImportAttempt, unregisteredAssets, unregisteredImportAllowedByPath]);

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

  const {
    canChooseImportFile,
    importCompatibilityHint,
    importEndpointHint,
    importEndpointRequired,
    importFileDeclaration,
  } = useLocalModelCenterImportFilePlan({
    showImportFileDialog,
    importFileAssetKind,
    importFileAuxiliaryEngine,
    importFileEndpoint,
  });

  const repairInstalledAsset = useCallback(async (localAssetId: string, endpoint: string) => {
    const asset = installedAssets.find((item) => item.localAssetId === localAssetId) || null;
    const manifestPath = manifestPathFromSourceRepo(asset?.source.repo);
    const normalizedEndpoint = String(endpoint || '').trim();
    if (!asset || !manifestPath) {
      throw new Error('Runtime manifest unavailable for asset repair');
    }
    if (!normalizedEndpoint) {
      throw new Error('Endpoint is required for asset repair');
    }
    setAssetBusy(true);
    try {
      await localRuntime.importAssetManifest(manifestPath, {
        caller: 'core',
        endpoint: normalizedEndpoint,
      });
      await refreshAssetSections();
      await refreshUnregisteredAssets();
    } finally {
      setAssetBusy(false);
    }
  }, [installedAssets, refreshAssetSections, refreshUnregisteredAssets]);

  return {
    activeDownloads: importActions.activeDownloads, activeImports: importActions.activeImports,
    assetBusy, assetKindFilter, assetPendingTemplateIds,
    assetImportError: importActions.assetImportError, assetImportSessionByPath: importActions.assetImportSessionByPath,
    catalogCapability, catalogDisplayCount, catalogItems,
    closeVariantPicker: importActions.closeVariantPicker,
    deferredSearchQuery, filteredInstalledDependencyAssets, filteredInstalledRunnableAssets,
    importFileAssetKind, importFileAuxiliaryEngine, importFileEndpoint, importFileDeclaration,
    importCompatibilityHint, importEndpointHint, importEndpointRequired, importMenuRef,
    importingAssetPath: importActions.importingAssetPath,
    installCatalogVariant, installMissingAssetsForModel, installVerifiedAsset, installVerifiedModel,
    installing, installedAssetsById, isAssetPending,
    loadingCatalog, loadingInstalledAssets, loadingVariants: importActions.loadingVariants,
    loadingVerifiedAssets, loadingVerifiedModels,
    onCancelDownload: importActions.onCancelDownload, onDismissSession: importActions.onDismissSession,
    onPauseDownload: importActions.onPauseDownload, onResumeDownload: importActions.onResumeDownload,
    refreshAssetSections, refreshUnregisteredAssets, refreshVerifiedModels,
    repairInstalledAsset, relatedAssetsByModelTemplate, removeInstalledAsset,
    resolveUnregisteredAssetDraft, searchQuery, selectedCatalogCapability, selectedCatalogEngine,
    setAssetKindFilter, setCatalogCapability, setCatalogCapabilityOverrides,
    setCatalogDisplayCount, setCatalogEngineOverrides,
    setImportFileAssetKind, setImportFileAuxiliaryEngine, setImportFileEndpoint,
    setSearchQuery, setShowImportFileDialog, setShowImportMenu,
    setUnregisteredAssetKind, setUnregisteredAuxiliaryEngine, setUnregisteredEndpoint,
    showImportFileDialog, showImportMenu, canChooseImportFile,
    toggleVariantPicker: importActions.toggleVariantPicker,
    unregisteredAssetDrafts, unregisteredAssets,
    unregisteredCompatibilityHintByPath, unregisteredEndpointByPath,
    unregisteredEndpointRequiredByPath, unregisteredEndpointHintByPath, unregisteredImportAllowedByPath,
    importPickedAssetFile: importActions.importPickedAssetFile,
    importPickedAssetManifest: importActions.importPickedAssetManifest,
    importUnregisteredAsset,
    variantError: importActions.variantError, variantList: importActions.variantList,
    variantPickerItem: importActions.variantPickerItem,
    verifiedModels, visibleAssetTasks, visibleVerifiedAssets,
  };
}
