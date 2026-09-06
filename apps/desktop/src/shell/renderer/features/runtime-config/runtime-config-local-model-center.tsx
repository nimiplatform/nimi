import { useQuery } from '@tanstack/react-query';
import type { NimiRuntimeLocalInstallPlanDescriptor } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { LocalModelCenterRuntimeView } from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import { LocalModelCatalogSection } from './runtime-config-local-model-center-catalog';

export function LocalModelCenter(props: {
  readonly runtimeWritesDisabled: boolean;
  readonly installResolvedModelPlan: (plan: NimiRuntimeLocalInstallPlanDescriptor) => Promise<void>;
}) {
  const commands = useDesktopRendererCommands();
  const runtimeState = useLocalModelCenterRuntimeState();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const catalog = useQuery({
    queryKey: ['runtime-config', 'builtin-catalog'],
    queryFn: () => client.listVerifiedAssets(),
    refetchOnWindowFocus: false,
  });

  return (
    <LocalModelCenterRuntimeView
      catalogContent={(
        <LocalModelCatalogSection assets={catalog.data ?? []} loading={catalog.isPending}
          error={catalog.error?.message ?? ''} runtimeWritesDisabled={props.runtimeWritesDisabled}
          onRefresh={() => { void catalog.refetch(); }}
          onInstall={async (templateId) => {
            const plan = await client.resolveInstallPlan({ source: 'verified', templateId });
            if (!plan.installAvailable) throw new Error(plan.warnings.join(' · ') || plan.reasonCode);
            await props.installResolvedModelPlan(plan);
            await runtimeState.refreshInstalledAssets();
          }} />
      )}
      assetBusy={runtimeState.assetBusy}
      assetImportError={runtimeState.assetImportError}
      loadingInstalledAssets={runtimeState.loadingInstalledAssets}
      modelAssets={runtimeState.modelAssets}
      runtimeInventoryError={runtimeState.runtimeInventoryError}
      importMenuRef={runtimeState.importMenuRef}
      showImportMenu={runtimeState.showImportMenu}
      runtimeWritesDisabled={props.runtimeWritesDisabled}
      downloads={runtimeState.activeDownloads}
      imports={runtimeState.activeImports}
      terminalDownloads={runtimeState.terminalDownloads}
      terminalImports={runtimeState.terminalImports}
      onCancelDownload={runtimeState.onCancelDownload}
      onDismissImportError={runtimeState.dismissAssetImportError}
      onDismissSession={runtimeState.onDismissSession}
      onImportFile={() => {
        runtimeState.setShowImportMenu(false);
        return runtimeState.importPickedAssetFile();
      }}
      onImportDirectory={() => {
        runtimeState.setShowImportMenu(false);
        return runtimeState.importPickedAssetDirectory();
      }}
      onInspectRemoval={runtimeState.inspectInstalledAssetRemoval}
      onOpenModelsFolder={() => { void commands.revealLocalRuntimeAssetsRootFolder(); }}
      onPauseDownload={runtimeState.onPauseDownload}
      onRefreshAssets={() => { void runtimeState.refreshInstalledAssets(); }}
      onRemoveAsset={runtimeState.removeInstalledAsset}
      onResumeDownload={runtimeState.onResumeDownload}
      onToggleImportMenu={() => runtimeState.setShowImportMenu((previous) => !previous)}
    />
  );
}
