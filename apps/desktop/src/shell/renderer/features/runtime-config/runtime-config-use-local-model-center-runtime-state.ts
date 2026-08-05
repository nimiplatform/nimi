import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import {
  normalizeCapabilityOption,
  CAPABILITY_OPTIONS,
  type AssetEngineOption,
  type CapabilityOption,
  type LocalModelCenterProps,
} from './runtime-config-model-center-utils';
import {
  relatedPassiveAssetsForRunnable,
} from './runtime-config-local-model-center-helpers';
import {
  canImportDeclaration,
  isRunnableAssetKind,
} from './runtime-config-use-local-model-center-helpers.js';
import { useRuntimeConfigLocalModelCenterClient } from './runtime-config-local-model-center-sdk-service';
import {
  useLocalModelCenterImportFilePlan,
} from './runtime-config-use-local-model-center-import-file-plan';
import { toCanonicalNimiRuntimeLocalAssetLookupKey } from '@nimiplatform/sdk/runtime';
import { useLocalModelCenterImportActions } from './runtime-config-use-local-model-center-import-actions';
import {
  useLocalModelCenterRuntimeDependencies,
} from './runtime-config-use-local-model-center-runtime-dependencies';
import { useLocalModelCenterInstalledAssetViews } from './runtime-config-use-local-model-center-installed-assets';
import { useLocalModelCenterUnregisteredAssets } from './runtime-config-use-local-model-center-unregistered-assets';
import { useLocalModelCenterAssetTasks } from './runtime-config-use-local-model-center-asset-tasks';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type UseLocalModelCenterRuntimeStateInput = {
  props: LocalModelCenterProps;
};

function runtimeInventoryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
}

export function useLocalModelCenterRuntimeState({ props }: UseLocalModelCenterRuntimeStateInput) {
  const runtimeConfigLocalModelCenterClient = useRuntimeConfigLocalModelCenterClient();
  const bindings = useDesktopRendererBindings();
  const [installing, setInstalling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<NimiRuntimeLocalCatalogItemDescriptor[]>([]);
  const [catalogDisplayCount, setCatalogDisplayCount] = useState(10);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [verifiedModels, setVerifiedModels] = useState<NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [installedAssets, setInstalledAssets] = useState<NimiRuntimeLocalAssetRecord[]>([]);
  const [loadingInstalledAssets, setLoadingInstalledAssets] = useState(false);
  const [verifiedAssets, setVerifiedAssets] = useState<NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedAssets, setLoadingVerifiedAssets] = useState(false);
  const [runtimeInventoryError, setRuntimeInventoryError] = useState('');
  const [assetKindFilter, setAssetKindFilter] = useState<'all' | NimiRuntimeLocalAssetKind>('all');
  const [assetBusy, setAssetBusy] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showImportFileDialog, setShowImportFileDialog] = useState(false);
  const [importFileAssetKind, setImportFileAssetKind] = useState<NimiRuntimeLocalAssetKind>('chat');
  const [importFileAuxiliaryEngine, setImportFileAuxiliaryEngine] = useState<AssetEngineOption | ''>('');
  const [importFileEndpoint, setImportFileEndpoint] = useState('');
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});
  const {
    refreshUnregisteredAssets: refreshUnregisteredAssetsState,
    resolveUnregisteredAssetDraft,
    setUnregisteredAssetKind,
    setUnregisteredAuxiliaryEngine,
    setUnregisteredEndpoint,
    unregisteredAssetDrafts,
    unregisteredAssets,
    unregisteredCompatibilityHintByPath,
    unregisteredEndpointByPath,
    unregisteredEndpointHintByPath,
    unregisteredEndpointRequiredByPath,
    unregisteredImportAllowedByPath,
  } = useLocalModelCenterUnregisteredAssets();

  useEffect(() => {
    if (!showImportMenu) {
      return undefined;
    }
    const handler = (event: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target as Node)) {
        setShowImportMenu(false);
      }
    };
    return bindings.app.events.subscribeDocumentMouseDown(handler);
  }, [bindings.app.events, showImportMenu]);

  const {
    filteredInstalledDependencyAssets,
    filteredInstalledRunnableAssets,
    sortedInstalledRunnableAssets,
    visibleInstalledAssets,
  } = useLocalModelCenterInstalledAssetViews({
    assetKindFilter,
    deferredSearchQuery,
    installedAssets,
  });

  const installedRunnableAssetIds = useMemo(
    () => new Set(sortedInstalledRunnableAssets.map((asset) => toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId)).filter(Boolean)),
    [sortedInstalledRunnableAssets],
  );

  const installedAssetsById = useMemo(
    () => new Map(visibleInstalledAssets.map((asset) => [toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId), asset] as const)),
    [visibleInstalledAssets],
  );

  const isRunnableAssetInstalled = useCallback((assetId: string) => (
    installedRunnableAssetIds.has(toCanonicalNimiRuntimeLocalAssetLookupKey(assetId))
  ), [installedRunnableAssetIds]);

  const inferredCatalogCapability = useCallback((item: NimiRuntimeLocalCatalogItemDescriptor): CapabilityOption => (
    normalizeCapabilityOption(item.capabilities.find((capability) => (
      CAPABILITY_OPTIONS.includes(capability as CapabilityOption)
    )))
  ), []);

  const selectedCatalogCapability = useCallback((item: NimiRuntimeLocalCatalogItemDescriptor): CapabilityOption => (
    catalogCapabilityOverrides[item.itemId] || inferredCatalogCapability(item)
  ), [catalogCapabilityOverrides, inferredCatalogCapability]);

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
      const rows = await runtimeConfigLocalModelCenterClient.searchCatalog({
        query,
        capability: capability === 'all' ? undefined : capability,
        limit: 30,
      });
      if (!mountedRef.current || requestId !== catalogRequestSeqRef.current) {
        return;
      }
      setCatalogItems(rows.filter((item) => !isRunnableAssetInstalled(item.modelId)));
      setRuntimeInventoryError('');
    } catch (error) {
      if (!mountedRef.current || requestId !== catalogRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError(runtimeInventoryErrorMessage(error, 'Runtime catalog discovery failed.'));
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
      const rows = await runtimeConfigLocalModelCenterClient.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setVerifiedModels(rows.filter((item) => (
        isRunnableAssetKind(item.kind) && !isRunnableAssetInstalled(item.assetId)
      )).slice(0, 5));
      setRuntimeInventoryError('');
    } catch (error) {
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError(runtimeInventoryErrorMessage(error, 'Runtime verified model discovery failed.'));
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
      const rows = await runtimeConfigLocalModelCenterClient.listAssets();
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) {
        return;
      }
      setInstalledAssets([...rows]);
      setRuntimeInventoryError('');
    } catch (error) {
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError(runtimeInventoryErrorMessage(error, 'Runtime installed asset discovery failed.'));
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
      const rows = await runtimeConfigLocalModelCenterClient.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedAssetsRequestSeqRef.current) {
        return;
      }
      setVerifiedAssets([...rows]);
      setRuntimeInventoryError('');
    } catch (error) {
      if (!mountedRef.current || requestId !== verifiedAssetsRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError(runtimeInventoryErrorMessage(error, 'Runtime verified asset discovery failed.'));
    } finally {
      if (mountedRef.current && requestId === verifiedAssetsRequestSeqRef.current) {
        setLoadingVerifiedAssets(false);
      }
    }
  }, []);

  const refreshUnregisteredAssets = useCallback(async () => {
    const requestId = ++unregisteredAssetsRequestSeqRef.current;
    await refreshUnregisteredAssetsState(() => (
      mountedRef.current && requestId === unregisteredAssetsRequestSeqRef.current
    ));
  }, [refreshUnregisteredAssetsState]);

  useEffect(() => {
    setCatalogDisplayCount(10);
  }, [deferredSearchQuery, catalogCapability]);

  useEffect(() => bindings.clock.schedule(600, (result) => {
    if (result.ok) void refreshCatalogItems();
  }), [bindings.clock, catalogCapability, deferredSearchQuery, refreshCatalogItems]);

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
      if (isRunnableAssetKind(asset.kind)) {
        return false;
      }
      if (assetKindFilter !== 'all' && asset.kind !== assetKindFilter) {
        return false;
      }
      if (installedAssetsById.has(toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId))) {
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
    return candidates;
  }, [assetKindFilter, deferredSearchQuery, installedAssetsById, verifiedAssets]);

  const relatedAssetsByModelTemplate = useMemo(() => {
    const next = new Map<string, NimiRuntimeLocalVerifiedAssetDescriptor[]>();
    for (const model of verifiedModels) {
      next.set(model.templateId, relatedPassiveAssetsForRunnable(model, verifiedAssets));
    }
    return next;
  }, [verifiedAssets, verifiedModels]);

  const verifiedAssetsByTemplateId = useMemo(
    () => new Map(verifiedAssets.map((asset) => [asset.templateId, asset] as const)),
    [verifiedAssets],
  );

  const refreshAssetInventorySections = useCallback(async () => {
    await Promise.all([refreshInstalledAssets(), refreshVerifiedAssets()]);
  }, [refreshInstalledAssets, refreshVerifiedAssets]);

  const {
    cancelRuntimeDependencyJob,
    refreshRuntimeDependencies,
    repairRuntimeDependency,
    prepareAssetRuntimeDependencies,
    retryRuntimeDependencyJob,
    runtimeDependencyByLocalAssetId,
    runtimeDependencyError,
    setupRuntimeDependency,
    sharedRuntimeDependency,
    sharedRuntimeDependencyJobs,
  } = useLocalModelCenterRuntimeDependencies({
    assets: sortedInstalledRunnableAssets,
    refreshAssetInventorySections,
    setAssetBusy,
  });

  const refreshAssetSections = useCallback(async () => {
    await refreshAssetInventorySections();
    refreshRuntimeDependencies();
  }, [refreshAssetInventorySections, refreshRuntimeDependencies]);

  const {
    assetPendingTemplateIds,
    installVerifiedAsset,
    isAssetPending,
    visibleAssetTasks,
  } = useLocalModelCenterAssetTasks({
    onInstallVerifiedAsset: props.onInstallVerifiedAsset,
    verifiedAssetsByTemplateId,
  });

  const installMissingAssetsForModel = useCallback(async (assets: NimiRuntimeLocalVerifiedAssetDescriptor[]) => {
    const missing = assets.filter((asset) => !installedAssetsById.has(toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId)));
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
    onPrepareImportedAssetEnvironment: prepareAssetRuntimeDependencies,
    onRefreshUnregisteredAssets: refreshUnregisteredAssets,
    onRefreshAssetSections: refreshAssetSections,
    onRefreshVerifiedModels: refreshVerifiedModels,
    props,
  });

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

  const installCatalogVariant = useCallback(async (
    item: NimiRuntimeLocalCatalogItemDescriptor,
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
  const canChooseImportDirectory = importFileAssetKind === 'chat';

  const rescanInstalledAsset = useCallback(async (localAssetId: string) => {
    setAssetBusy(true);
    try {
      await runtimeConfigLocalModelCenterClient.rescanBundle({ localAssetId }, { caller: 'core' });
      await refreshAssetSections();
      await refreshUnregisteredAssets();
    } finally {
      setAssetBusy(false);
    }
  }, [refreshAssetSections, refreshUnregisteredAssets]);

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
    relatedAssetsByModelTemplate, removeInstalledAsset,
    cancelRuntimeDependencyJob, repairRuntimeDependency, retryRuntimeDependencyJob,
    runtimeDependencyByLocalAssetId, runtimeDependencyError, runtimeInventoryError,
    resolveUnregisteredAssetDraft, searchQuery, selectedCatalogCapability,
    setAssetKindFilter, setCatalogCapability, setCatalogCapabilityOverrides,
    setCatalogDisplayCount,
    setImportFileAssetKind, setImportFileAuxiliaryEngine, setImportFileEndpoint,
    setSearchQuery, setShowImportFileDialog, setShowImportMenu,
    setupRuntimeDependency, sharedRuntimeDependency, sharedRuntimeDependencyJobs,
    setUnregisteredAssetKind, setUnregisteredAuxiliaryEngine, setUnregisteredEndpoint,
    showImportFileDialog, showImportMenu, canChooseImportFile, canChooseImportDirectory,
    toggleVariantPicker: importActions.toggleVariantPicker,
    unregisteredAssetDrafts, unregisteredAssets,
    unregisteredCompatibilityHintByPath, unregisteredEndpointByPath,
    unregisteredEndpointRequiredByPath, unregisteredEndpointHintByPath, unregisteredImportAllowedByPath,
    importPickedAssetFile: importActions.importPickedAssetFile,
    importPickedAssetDirectory: importActions.importPickedAssetDirectory,
    importPickedAssetManifest: importActions.importPickedAssetManifest,
    importUnregisteredAsset,
    rescanInstalledAsset,
    variantError: importActions.variantError, variantList: importActions.variantList,
    variantPickerItem: importActions.variantPickerItem,
    verifiedModels, visibleAssetTasks, visibleVerifiedAssets,
  };
}
