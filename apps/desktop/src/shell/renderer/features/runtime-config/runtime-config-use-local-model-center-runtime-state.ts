import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  isNimiRuntimeLocalRunnableAssetKindId,
  type NimiRuntimeLocalCatalogItemDescriptor,
  type NimiRuntimeLocalVerifiedAssetDescriptor,
  type NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  normalizeCapabilityOption,
  CAPABILITY_OPTIONS,
  type CapabilityOption,
  type LocalModelCenterProps,
} from './runtime-config-model-center-utils';
import { useRuntimeConfigLocalAssetAdminClient } from './runtime-config-local-model-center-sdk-service';
import { useLocalModelCenterImportActions } from './runtime-config-use-local-model-center-import-actions';
import { useLocalModelCenterAssetTasks } from './runtime-config-use-local-model-center-asset-tasks';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useTranslation } from 'react-i18next';

type UseLocalModelCenterRuntimeStateInput = {
  props: LocalModelCenterProps;
};

type RuntimeInventoryErrorSlot = 'catalog' | 'verified-models' | 'model-assets' | 'verified-assets' | 'model-asset-action';

type RuntimeInventoryErrors = Partial<Record<RuntimeInventoryErrorSlot, string>>;

export function runtimeInventoryErrorFromSlots(errors: RuntimeInventoryErrors): string {
  return errors['model-asset-action']
    || errors['model-assets']
    || errors.catalog
    || errors['verified-models']
    || errors['verified-assets']
    || '';
}

function catalogAssetLookupKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function modelAssetCatalogLookupKeys(asset: NimiRuntimeModelAssetRecord): readonly string[] {
  const provenance = asset.provenance ?? {};
  return [...new Set([
    provenance.catalog_asset_id,
    provenance.catalog_template_id,
    provenance.source_repo,
  ].map(catalogAssetLookupKey).filter(Boolean))];
}

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
  const runtimeConfigLocalAssetAdminClient = useRuntimeConfigLocalAssetAdminClient();
  const bindings = useDesktopRendererBindings();
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [catalogCapability, setCatalogCapability] = useState<'all' | CapabilityOption>('all');
  const [catalogItems, setCatalogItems] = useState<NimiRuntimeLocalCatalogItemDescriptor[]>([]);
  const [catalogDisplayCount, setCatalogDisplayCount] = useState(10);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [verifiedModels, setVerifiedModels] = useState<NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedModels, setLoadingVerifiedModels] = useState(false);
  const [modelAssets, setModelAssets] = useState<NimiRuntimeModelAssetRecord[]>([]);
  const [loadingInstalledAssets, setLoadingInstalledAssets] = useState(false);
  const [verifiedAssets, setVerifiedAssets] = useState<NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loadingVerifiedAssets, setLoadingVerifiedAssets] = useState(false);
  const [runtimeInventoryErrors, setRuntimeInventoryErrors] = useState<RuntimeInventoryErrors>({});
  const runtimeInventoryError = runtimeInventoryErrorFromSlots(runtimeInventoryErrors);
  const setRuntimeInventoryError = useCallback((slot: RuntimeInventoryErrorSlot, message: string) => {
    setRuntimeInventoryErrors((current) => {
      const next = { ...current };
      if (message) next[slot] = message;
      else delete next[slot];
      return next;
    });
  }, []);
  const [assetBusy, setAssetBusy] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [catalogCapabilityOverrides, setCatalogCapabilityOverrides] = useState<Record<string, CapabilityOption>>({});

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

  const installedCatalogAssetsById = useMemo(() => {
    const installed = new Map<string, NimiRuntimeModelAssetRecord>();
    for (const asset of modelAssets) {
      for (const key of modelAssetCatalogLookupKeys(asset)) installed.set(key, asset);
    }
    return installed;
  }, [modelAssets]);

  const isRunnableAssetInstalled = useCallback((assetId: string) => (
    installedCatalogAssetsById.has(catalogAssetLookupKey(assetId))
  ), [installedCatalogAssetsById]);

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
      const rows = await runtimeConfigLocalAssetAdminClient.searchCatalog({
        query,
        capability: capability === 'all' ? undefined : capability,
        limit: 30,
      });
      if (!mountedRef.current || requestId !== catalogRequestSeqRef.current) {
        return;
      }
      setCatalogItems(rows.filter((item) => !isRunnableAssetInstalled(item.modelId)));
      setRuntimeInventoryError('catalog', '');
    } catch (error) {
      if (!mountedRef.current || requestId !== catalogRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError('catalog', runtimeInventoryErrorMessage(error, 'Runtime catalog discovery failed.'));
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
      const rows = await runtimeConfigLocalAssetAdminClient.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setVerifiedModels(rows.filter((item) => (
        isNimiRuntimeLocalRunnableAssetKindId(item.kind) && !isRunnableAssetInstalled(item.assetId)
      )).slice(0, 5));
      setRuntimeInventoryError('verified-models', '');
    } catch (error) {
      if (!mountedRef.current || requestId !== verifiedModelsRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError('verified-models', runtimeInventoryErrorMessage(error, 'Runtime verified model discovery failed.'));
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
      const modelAssetRows = await runtimeConfigLocalAssetAdminClient.listModelAssets();
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) {
        return;
      }
      setModelAssets([...modelAssetRows]);
      setRuntimeInventoryError('model-assets', '');
    } catch (error) {
      if (!mountedRef.current || requestId !== installedAssetsRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError('model-assets', runtimeInventoryErrorMessage(error, 'Runtime ModelAsset discovery failed.'));
    } finally {
      if (mountedRef.current && requestId === installedAssetsRequestSeqRef.current) {
        setLoadingInstalledAssets(false);
      }
    }
  }, [runtimeConfigLocalAssetAdminClient]);

  const refreshVerifiedAssets = useCallback(async () => {
    const requestId = ++verifiedAssetsRequestSeqRef.current;
    setLoadingVerifiedAssets(true);
    try {
      const rows = await runtimeConfigLocalAssetAdminClient.listVerifiedAssets();
      if (!mountedRef.current || requestId !== verifiedAssetsRequestSeqRef.current) {
        return;
      }
      setVerifiedAssets([...rows]);
      setRuntimeInventoryError('verified-assets', '');
    } catch (error) {
      if (!mountedRef.current || requestId !== verifiedAssetsRequestSeqRef.current) {
        return;
      }
      setRuntimeInventoryError('verified-assets', runtimeInventoryErrorMessage(error, 'Runtime verified asset discovery failed.'));
    } finally {
      if (mountedRef.current && requestId === verifiedAssetsRequestSeqRef.current) {
        setLoadingVerifiedAssets(false);
      }
    }
  }, []);

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

  const visibleVerifiedAssets = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim();
    const candidates = verifiedAssets.filter((asset) => {
      if (isNimiRuntimeLocalRunnableAssetKindId(asset.kind)) {
        return false;
      }
      if (installedCatalogAssetsById.has(catalogAssetLookupKey(asset.assetId))) {
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
  }, [deferredSearchQuery, installedCatalogAssetsById, verifiedAssets]);

  const filteredModelAssets = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (!query) return modelAssets;
    return modelAssets.filter((asset) => (
      asset.modelAssetId.toLowerCase().includes(query)
      || asset.displayName.toLowerCase().includes(query)
      || asset.entry.toLowerCase().includes(query)
      || asset.contentId.toLowerCase().includes(query)
    ));
  }, [deferredSearchQuery, modelAssets]);

  const verifiedAssetsByTemplateId = useMemo(
    () => new Map(verifiedAssets.map((asset) => [asset.templateId, asset] as const)),
    [verifiedAssets],
  );

  const refreshAssetSections = useCallback(async () => {
    await Promise.all([refreshInstalledAssets(), refreshVerifiedAssets()]);
  }, [refreshInstalledAssets, refreshVerifiedAssets]);

  const {
    assetPendingTemplateIds,
    installCatalogAsset,
    isAssetPending,
    visibleAssetTasks,
  } = useLocalModelCenterAssetTasks({
    onInstallCatalogAsset: props.onInstallCatalogAsset,
    onInstalled: refreshAssetSections,
    verifiedAssetsByTemplateId,
  });

  const inspectInstalledAssetRemoval = useCallback(async (modelAssetId: string) => {
    setAssetBusy(true);
    try {
      const inspection = await runtimeConfigLocalAssetAdminClient.inspectModelAssetRemoval(modelAssetId);
      return [...inspection.referencingLoadoutIds];
    } catch (error) {
      setRuntimeInventoryError('model-asset-action', runtimeInventoryErrorMessage(error, 'Runtime ModelAsset reference inspection failed.'));
      throw error;
    } finally {
      setAssetBusy(false);
    }
  }, [runtimeConfigLocalAssetAdminClient]);

  const removeInstalledAsset = useCallback(async (modelAssetId: string) => {
    setAssetBusy(true);
    try {
      const removal = await runtimeConfigLocalAssetAdminClient.removeModelAsset(modelAssetId, { caller: 'core' });
      setRuntimeInventoryError('model-asset-action', removal.cleanupPending
        ? t('runtimeConfig.localModelCenter.cleanupPending', {
          defaultValue: 'The ModelAsset record was removed, but owned file cleanup is pending and will retry automatically.',
        })
        : '');
      await refreshAssetSections();
    } catch (error) {
      setRuntimeInventoryError('model-asset-action', runtimeInventoryErrorMessage(error, 'Runtime ModelAsset removal failed.'));
      throw error;
    } finally {
      setAssetBusy(false);
    }
  }, [refreshAssetSections, runtimeConfigLocalAssetAdminClient, t]);

  const installCatalogQuickPick = useCallback(async (templateId: string) => {
    setInstalling(true);
    try {
      await props.onInstallCatalogAsset(templateId);
      await refreshAssetSections();
    } finally {
      setInstalling(false);
    }
  }, [props, refreshAssetSections]);

  const importActions = useLocalModelCenterImportActions({
    onRefreshAssetSections: refreshAssetSections,
    onRefreshVerifiedModels: refreshVerifiedModels,
    props,
  });

  const installCatalogVariant = useCallback(async (
    item: NimiRuntimeLocalCatalogItemDescriptor,
    variantFilename: string,
  ) => {
    importActions.closeVariantPicker();
    setInstalling(true);
    try {
      await importActions.installCatalogVariant(item, variantFilename);
      await refreshAssetSections();
    } finally {
      setInstalling(false);
    }
  }, [importActions, refreshAssetSections]);

  return {
    activeDownloads: importActions.activeDownloads, activeImports: importActions.activeImports,
    assetBusy, assetPendingTemplateIds,
    assetImportError: importActions.assetImportError,
    catalogCapability, catalogDisplayCount, catalogItems,
    closeVariantPicker: importActions.closeVariantPicker,
    deferredSearchQuery, filteredModelAssets,
    importMenuRef,
    importingAssetPath: importActions.importingAssetPath,
    installCatalogAsset, installCatalogQuickPick, installCatalogVariant,
    installing, installedCatalogAssetsById, isAssetPending,
    loadingCatalog, loadingInstalledAssets, loadingVariants: importActions.loadingVariants,
    loadingVerifiedAssets, loadingVerifiedModels,
    onCancelDownload: importActions.onCancelDownload, onDismissSession: importActions.onDismissSession,
    onPauseDownload: importActions.onPauseDownload, onResumeDownload: importActions.onResumeDownload,
    refreshAssetSections, refreshVerifiedModels,
    removeInstalledAsset, inspectInstalledAssetRemoval,
    runtimeInventoryError,
    searchQuery, selectedCatalogCapability,
    setCatalogCapability, setCatalogCapabilityOverrides,
    setCatalogDisplayCount,
    setSearchQuery, setShowImportMenu,
    showImportMenu,
    toggleVariantPicker: importActions.toggleVariantPicker,
    importPickedAssetFile: importActions.importPickedAssetFile,
    importPickedAssetDirectory: importActions.importPickedAssetDirectory,
    variantError: importActions.variantError, variantList: importActions.variantList,
    variantPickerItem: importActions.variantPickerItem,
    verifiedModels, visibleAssetTasks, visibleVerifiedAssets,
  };
}
