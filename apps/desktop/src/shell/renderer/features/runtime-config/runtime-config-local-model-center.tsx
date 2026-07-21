import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type NimiRuntimeLocalProfileResolutionPlan,
} from '@nimiplatform/sdk/runtime';
import { revealLocalRuntimeAssetsRootFolder } from '../../bridge/runtime-bridge/local-runtime-os-helpers';
import {
  normalizeSelectedProfileCapability,
  type LocalModelCenterProps,
  resolveProfileCapabilityOptions,
  resolveSelectedRuntimeProfileTarget,
} from './runtime-config-model-center-utils';
import { LocalModelCenterProfileTargetView } from './runtime-config-local-model-center-sections';
import { LocalModelCenterRuntimeView } from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';

export function LocalModelCenter(props: LocalModelCenterProps) {
  const [internalSelectedProfileTargetId, setInternalSelectedProfileTargetId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfileCapability, setSelectedProfileCapability] = useState('');
  const [profilePlanPreview, setProfilePlanPreview] = useState<NimiRuntimeLocalProfileResolutionPlan | null>(null);
  const [loadingProfilePlan, setLoadingProfilePlan] = useState(false);

  const displayMode: 'runtime' | 'profile-target' = props.displayMode === 'profile-target' ? 'profile-target' : 'runtime';
  const isProfileTargetMode = displayMode === 'profile-target';
  const lockedProfileTargetId = String(props.lockedProfileTargetId || '').trim();
  const profileSelectionLocked = isProfileTargetMode && Boolean(lockedProfileTargetId);
  const selectedProfileTargetId = useMemo(
    () => (
      lockedProfileTargetId
      || String(props.selectedProfileTargetId || '').trim()
      || internalSelectedProfileTargetId
    ),
    [internalSelectedProfileTargetId, lockedProfileTargetId, props.selectedProfileTargetId],
  );

  useEffect(() => {
    if (selectedProfileTargetId || props.runtimeProfileTargets.length <= 0) {
      return;
    }
    const nextTargetId = String(props.runtimeProfileTargets[0]?.targetId || '').trim();
    if (nextTargetId) {
      setInternalSelectedProfileTargetId(nextTargetId);
      setSelectedProfileId(String(props.runtimeProfileTargets[0]?.profiles[0]?.id || '').trim());
    }
  }, [props.runtimeProfileTargets, selectedProfileTargetId]);
  const selectedProfileTarget = useMemo(
    () => resolveSelectedRuntimeProfileTarget(props.runtimeProfileTargets, selectedProfileTargetId),
    [props.runtimeProfileTargets, selectedProfileTargetId],
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
    const targetId = String(selectedProfileTargetId || '').trim();
    const profileId = String(selectedProfileId || '').trim() || String(selectedProfileTarget?.profiles[0]?.id || '').trim();
    const capabilityOptions = resolveProfileCapabilityOptions(selectedProfile);
    const capability = normalizeSelectedProfileCapability(selectedProfile, selectedProfileCapability);
    if (!targetId || !profileId) {
      setProfilePlanPreview(null);
      return;
    }
    if (capabilityOptions.length > 1 && !capability) {
      setProfilePlanPreview(null);
      return;
    }
    setLoadingProfilePlan(true);
    try {
      const plan = await props.onResolveProfile(targetId, profileId, capability || undefined);
      setProfilePlanPreview(plan);
    } catch {
      setProfilePlanPreview(null);
    } finally {
      setLoadingProfilePlan(false);
    }
  }, [props, selectedProfile, selectedProfileCapability, selectedProfileId, selectedProfileTargetId, selectedProfileTarget]);

  useEffect(() => {
    setProfilePlanPreview(null);
  }, [selectedProfileCapability, selectedProfileId, selectedProfileTargetId]);
  const runtimeState = useLocalModelCenterRuntimeState({ isProfileTargetMode, props });

  if (isProfileTargetMode) {
    return (
      <LocalModelCenterProfileTargetView
        state={props.state}
        selectedProfileTargetId={selectedProfileTargetId}
        loadingProfilePlan={loadingProfilePlan}
        profileSelectionLocked={profileSelectionLocked}
        selectedProfileId={selectedProfileId}
        selectedProfileCapability={selectedProfileCapability}
        profilePlanPreview={profilePlanPreview}
        runtimeProfileTargets={props.runtimeProfileTargets}
        onSetSelectedProfileTargetId={(targetId) => {
          if (!profileSelectionLocked) {
            setInternalSelectedProfileTargetId(targetId);
            props.onSelectProfileTargetId?.(targetId);
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
      sharedRuntimeDependency={runtimeState.sharedRuntimeDependency}
      sharedRuntimeDependencyJobs={runtimeState.sharedRuntimeDependencyJobs}
      runtimeDependencyByLocalAssetId={runtimeState.runtimeDependencyByLocalAssetId}
      runtimeDependencyError={runtimeState.runtimeDependencyError}
      runtimeInventoryError={runtimeState.runtimeInventoryError}
      hasSearchQuery={hasSearchQuery}
      importFileAssetKind={runtimeState.importFileAssetKind}
      importFileAuxiliaryEngine={runtimeState.importFileAuxiliaryEngine}
      importFileEndpoint={runtimeState.importFileEndpoint}
      importCompatibilityHint={runtimeState.importCompatibilityHint}
      importEndpointRequired={runtimeState.importEndpointRequired}
      importEndpointHint={runtimeState.importEndpointHint}
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
      unregisteredCompatibilityHintByPath={runtimeState.unregisteredCompatibilityHintByPath}
      unregisteredImportAllowedByPath={runtimeState.unregisteredImportAllowedByPath}
      unregisteredEndpointByPath={runtimeState.unregisteredEndpointByPath}
      unregisteredEndpointRequiredByPath={runtimeState.unregisteredEndpointRequiredByPath}
      unregisteredEndpointHintByPath={runtimeState.unregisteredEndpointHintByPath}
      onArtifactKindFilterChange={runtimeState.setAssetKindFilter}
      onCancelDownload={runtimeState.onCancelDownload}
      onAssetKindChange={(kind) => {
        runtimeState.setImportFileAssetKind(kind);
        if (kind !== 'auxiliary') {
          runtimeState.setImportFileAuxiliaryEngine('');
        }
      }}
      onAssetAuxiliaryEngineChange={runtimeState.setImportFileAuxiliaryEngine}
      onImportEndpointChange={runtimeState.setImportFileEndpoint}
      onCatalogCapabilityChange={runtimeState.setCatalogCapability}
      onCatalogCapabilityOverrideChange={(itemId, capability) => runtimeState.setCatalogCapabilityOverrides((prev) => ({
        ...prev,
        [itemId]: capability,
      }))}
      onChooseImportFile={() => {
        runtimeState.setShowImportFileDialog(false);
        void runtimeState.importPickedAssetFile(
          runtimeState.importFileDeclaration,
          runtimeState.importFileEndpoint,
        );
      }}
      onChooseImportDirectory={() => {
        runtimeState.setShowImportFileDialog(false);
        void runtimeState.importPickedAssetDirectory(
          runtimeState.importFileDeclaration,
          runtimeState.importFileEndpoint,
        );
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
      onOpenImportBundle={() => {
        runtimeState.setShowImportMenu(false);
        runtimeState.setImportFileAssetKind('chat');
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
      onRepairAsset={(localAssetId, endpoint) => { void runtimeState.repairInstalledAsset(localAssetId, endpoint); }}
      onSetupRuntimeDependency={() => { void runtimeState.setupRuntimeDependency(); }}
      onCancelRuntimeDependencyJob={(jobId) => { void runtimeState.cancelRuntimeDependencyJob(jobId); }}
      onRetryRuntimeDependencyJob={(jobId) => { void runtimeState.retryRuntimeDependencyJob(jobId); }}
      onRepairRuntimeDependency={() => { void runtimeState.repairRuntimeDependency(); }}
      onRescanAsset={(localAssetId) => { void runtimeState.rescanInstalledAsset(localAssetId); }}
      onResumeDownload={runtimeState.onResumeDownload}
      onSearchQueryChange={runtimeState.setSearchQuery}
      onToggleImportMenu={() => runtimeState.setShowImportMenu((prev) => !prev)}
      onToggleVariantPicker={runtimeState.toggleVariantPicker}
      onImportUnregisteredAsset={(path) => { void runtimeState.importUnregisteredAsset(path); }}
      onUnregisteredAssetKindChange={runtimeState.setUnregisteredAssetKind}
      onUnregisteredAuxiliaryEngineChange={runtimeState.setUnregisteredAuxiliaryEngine}
      onUnregisteredEndpointChange={runtimeState.setUnregisteredEndpoint}
      relatedAssetsByModelTemplate={runtimeState.relatedAssetsByModelTemplate}
      resolveUnregisteredAssetDraft={runtimeState.resolveUnregisteredAssetDraft}
      searchQuery={runtimeState.searchQuery}
      selectedCatalogCapability={runtimeState.selectedCatalogCapability}
      showImportFileDialog={runtimeState.showImportFileDialog}
      showImportMenu={runtimeState.showImportMenu}
      canChooseImportFile={runtimeState.canChooseImportFile}
      canChooseImportDirectory={runtimeState.canChooseImportDirectory}
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
