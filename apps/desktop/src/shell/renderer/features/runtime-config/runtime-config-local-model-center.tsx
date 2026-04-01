import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type LocalRuntimeProfileResolutionPlan,
} from '@runtime/local-runtime';
import { revealLocalRuntimeAssetsRootFolder } from '@runtime/local-runtime/commands';
import {
  type LocalModelCenterProps,
  normalizeSelectedProfileCapability,
  resolveProfileCapabilityOptions,
  resolveSelectedRuntimeProfileTarget,
} from './runtime-config-model-center-utils';
import { LocalModelCenterModModeView } from './runtime-config-local-model-center-sections';
import { LocalModelCenterRuntimeView } from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';

export function LocalModelCenter(props: LocalModelCenterProps) {
  const [internalSelectedProfileModId, setInternalSelectedProfileModId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfileCapability, setSelectedProfileCapability] = useState('');
  const [profilePlanPreview, setProfilePlanPreview] = useState<LocalRuntimeProfileResolutionPlan | null>(null);
  const [loadingProfilePlan, setLoadingProfilePlan] = useState(false);

  const displayMode: 'runtime' | 'mod' = props.displayMode === 'mod' ? 'mod' : 'runtime';
  const isModMode = displayMode === 'mod';
  const lockedProfileModId = String(props.lockedProfileModId || '').trim();
  const profileSelectionLocked = isModMode && Boolean(lockedProfileModId);
  const selectedProfileModId = useMemo(
    () => (
      lockedProfileModId
      || String(props.selectedProfileModId || '').trim()
      || internalSelectedProfileModId
    ),
    [internalSelectedProfileModId, lockedProfileModId, props.selectedProfileModId],
  );

  useEffect(() => {
    if (selectedProfileModId || props.runtimeProfileTargets.length <= 0) {
      return;
    }
    const nextModId = String(props.runtimeProfileTargets[0]?.modId || '').trim();
    if (nextModId) {
      setInternalSelectedProfileModId(nextModId);
      setSelectedProfileId(String(props.runtimeProfileTargets[0]?.profiles[0]?.id || '').trim());
    }
  }, [props.runtimeProfileTargets, selectedProfileModId]);
  const selectedProfileTarget = useMemo(
    () => resolveSelectedRuntimeProfileTarget(props.runtimeProfileTargets, selectedProfileModId),
    [props.runtimeProfileTargets, selectedProfileModId],
  );
  const selectedProfile = useMemo(() => {
    if (!selectedProfileTarget) {
      return null;
    }
    return selectedProfileTarget.profiles.find((profile) => profile.id === selectedProfileId)
      || selectedProfileTarget.profiles[0]
      || null;
  }, [selectedProfileId, selectedProfileTarget]);

  useEffect(() => {
    const nextCapability = normalizeSelectedProfileCapability(selectedProfile, selectedProfileCapability);
    if (nextCapability !== selectedProfileCapability) {
      setSelectedProfileCapability(nextCapability);
    }
  }, [selectedProfile, selectedProfileCapability]);

  const resolveProfilePlanPreview = useCallback(async () => {
    const modId = String(selectedProfileModId || '').trim();
    const profileId = String(selectedProfileId || '').trim() || String(selectedProfileTarget?.profiles[0]?.id || '').trim();
    const capabilityOptions = resolveProfileCapabilityOptions(selectedProfile);
    const capability = normalizeSelectedProfileCapability(selectedProfile, selectedProfileCapability);
    if (!modId || !profileId) {
      setProfilePlanPreview(null);
      return;
    }
    if (capabilityOptions.length > 1 && !capability) {
      setProfilePlanPreview(null);
      return;
    }
    setLoadingProfilePlan(true);
    try {
      const plan = await props.onResolveProfile(modId, profileId, capability || undefined);
      setProfilePlanPreview(plan);
    } catch {
      setProfilePlanPreview(null);
    } finally {
      setLoadingProfilePlan(false);
    }
  }, [props, selectedProfile, selectedProfileCapability, selectedProfileId, selectedProfileModId, selectedProfileTarget]);

  useEffect(() => {
    setProfilePlanPreview(null);
  }, [selectedProfileCapability, selectedProfileId, selectedProfileModId]);
  const runtimeState = useLocalModelCenterRuntimeState({ isModMode, props });

  if (isModMode) {
    return (
      <LocalModelCenterModModeView
        state={props.state}
        selectedProfileModId={selectedProfileModId}
        loadingProfilePlan={loadingProfilePlan}
        profileSelectionLocked={profileSelectionLocked}
        selectedProfileId={selectedProfileId}
        selectedProfileCapability={selectedProfileCapability}
        profilePlanPreview={profilePlanPreview}
        runtimeProfileTargets={props.runtimeProfileTargets}
        onSetSelectedProfileModId={(modId) => {
          if (!profileSelectionLocked) {
            setInternalSelectedProfileModId(modId);
            props.onSelectProfileModId?.(modId);
            setSelectedProfileId('');
            setSelectedProfileCapability('');
          }
        }}
        onSetSelectedProfileId={(profileId) => {
          setSelectedProfileId(profileId);
          setSelectedProfileCapability('');
        }}
        onSetSelectedProfileCapability={setSelectedProfileCapability}
        onResolveProfilePlanPreview={() => void resolveProfilePlanPreview()}
        onApplyProfile={props.onApplyProfile}
        onNavigateToSetup={props.onNavigateToSetup}
      />
    );
  }

  const hasSearchQuery = runtimeState.searchQuery.trim().length > 0;
  const localHealthy = props.state.local.status === 'healthy';

  return (
    <LocalModelCenterRuntimeView
      assetBusy={runtimeState.assetBusy}
      assetKindFilter={runtimeState.assetKindFilter}
      assetPendingTemplateIds={runtimeState.assetPendingTemplateIds}
      catalogCapability={runtimeState.catalogCapability}
      catalogDisplayCount={runtimeState.catalogDisplayCount}
      catalogItems={runtimeState.catalogItems}
      checkingHealth={props.checkingHealth}
      deferredSearchQuery={runtimeState.deferredSearchQuery}
      discovering={props.discovering}
      filteredInstalledDependencyAssets={runtimeState.filteredInstalledDependencyAssets}
      filteredInstalledRunnableAssets={runtimeState.filteredInstalledRunnableAssets}
      hasSearchQuery={hasSearchQuery}
      importFileAssetClass={runtimeState.importFileAssetClass}
      importFileModelType={runtimeState.importFileModelType}
      importFileDependencyKind={runtimeState.importFileDependencyKind}
      importFileAuxiliaryEngine={runtimeState.importFileAuxiliaryEngine}
      importMenuRef={runtimeState.importMenuRef}
      importingAssetPath={runtimeState.importingAssetPath}
      installing={runtimeState.installing}
      installedAssetsById={runtimeState.installedAssetsById}
      isAssetPending={runtimeState.isAssetPending}
      lastCheckedAt={props.state.local.lastCheckedAt}
      loadingCatalog={runtimeState.loadingCatalog}
      loadingInstalledAssets={runtimeState.loadingInstalledAssets}
      loadingVariants={runtimeState.loadingVariants}
      loadingVerifiedAssets={runtimeState.loadingVerifiedAssets}
      loadingVerifiedModels={runtimeState.loadingVerifiedModels}
      localHealthy={localHealthy}
      assetImportError={runtimeState.assetImportError}
      assetImportSessionByPath={runtimeState.assetImportSessionByPath}
      onArtifactKindFilterChange={runtimeState.setAssetKindFilter}
      onCancelDownload={runtimeState.onCancelDownload}
      onAssetClassChange={runtimeState.setImportFileAssetClass}
      onAssetModelTypeChange={runtimeState.setImportFileModelType}
      onAssetDependencyKindChange={(kind) => {
        runtimeState.setImportFileDependencyKind(kind);
        if (kind !== 'auxiliary') {
          runtimeState.setImportFileAuxiliaryEngine('');
        }
      }}
      onAssetAuxiliaryEngineChange={runtimeState.setImportFileAuxiliaryEngine}
      onCatalogCapabilityChange={runtimeState.setCatalogCapability}
      onCatalogCapabilityOverrideChange={(itemId, capability) => runtimeState.setCatalogCapabilityOverrides((prev) => ({
        ...prev,
        [itemId]: capability,
      }))}
      onCatalogEngineOverrideChange={(itemId, engine) => runtimeState.setCatalogEngineOverrides((prev) => ({
        ...prev,
        [itemId]: engine,
      }))}
      onChooseImportFile={() => {
        runtimeState.setShowImportFileDialog(false);
        void runtimeState.importPickedAssetFile(runtimeState.importFileDeclaration);
      }}
      onCloseImportFileDialog={() => runtimeState.setShowImportFileDialog(false)}
      onCloseVariantPicker={runtimeState.closeVariantPicker}
      onOpenModelsFolder={() => { void revealLocalRuntimeAssetsRootFolder(); }}
      onHealthCheck={() => void props.onHealthCheck()}
      onImportManifest={() => {
        runtimeState.setShowImportMenu(false);
        void runtimeState.importPickedAssetManifest();
      }}
      onInstallAsset={(templateId) => { void runtimeState.installVerifiedAsset(templateId); }}
      onInstallCatalogVariant={(item, variantFilename) => { void runtimeState.installCatalogVariant(item, variantFilename); }}
      onInstallMissingAssets={(assets) => { void runtimeState.installMissingAssetsForModel(assets); }}
      onInstallVerifiedModel={(templateId) => { void runtimeState.installVerifiedModel(templateId); }}
      onLoadMoreCatalog={() => runtimeState.setCatalogDisplayCount((prev) => prev + 10)}
      onOpenImportFile={() => {
        runtimeState.setShowImportMenu(false);
        runtimeState.setShowImportFileDialog(true);
      }}
      onPauseDownload={runtimeState.onPauseDownload}
      onRefresh={() => {
        void props.onDiscover().finally(() => {
          void runtimeState.refreshUnregisteredAssets();
        });
      }}
      onRefreshAssets={() => { void runtimeState.refreshAssetSections(); }}
      onRefreshQuickPicks={() => { void runtimeState.refreshVerifiedModels(); }}
      onRefreshUnregisteredAssets={() => { void runtimeState.refreshUnregisteredAssets(); }}
      onRemoveAsset={(localAssetId) => { void runtimeState.removeInstalledAsset(localAssetId); }}
      onResumeDownload={runtimeState.onResumeDownload}
      onSearchQueryChange={runtimeState.setSearchQuery}
      onToggleImportMenu={() => runtimeState.setShowImportMenu((prev) => !prev)}
      onToggleVariantPicker={runtimeState.toggleVariantPicker}
      onImportUnregisteredAsset={(path) => { void runtimeState.importUnregisteredAsset(path); }}
      onUnregisteredAssetClassChange={runtimeState.setUnregisteredAssetClass}
      onUnregisteredModelTypeChange={runtimeState.setUnregisteredModelType}
      onUnregisteredDependencyKindChange={runtimeState.setUnregisteredDependencyKind}
      onUnregisteredAuxiliaryEngineChange={runtimeState.setUnregisteredAuxiliaryEngine}
      relatedAssetsByModelTemplate={runtimeState.relatedAssetsByModelTemplate}
      resolveUnregisteredAssetDraft={runtimeState.resolveUnregisteredAssetDraft}
      searchQuery={runtimeState.searchQuery}
      selectedCatalogCapability={runtimeState.selectedCatalogCapability}
      selectedCatalogEngine={runtimeState.selectedCatalogEngine}
      showImportFileDialog={runtimeState.showImportFileDialog}
      showImportMenu={runtimeState.showImportMenu}
      canChooseImportFile={runtimeState.canChooseImportFile}
      variantError={runtimeState.variantError}
      variantList={runtimeState.variantList}
      variantPickerItem={runtimeState.variantPickerItem}
      verifiedModels={runtimeState.verifiedModels}
      visibleAssetTasks={runtimeState.visibleAssetTasks}
      visibleVerifiedAssets={runtimeState.visibleVerifiedAssets}
      downloads={runtimeState.activeDownloads}
      imports={runtimeState.activeImports}
      onDismissSession={runtimeState.onDismissSession}
      unregisteredAssets={runtimeState.unregisteredAssets}
    />
  );
}
