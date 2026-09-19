import { useQuery } from '@tanstack/react-query';
import type { NimiRuntimeLocalInstallPlanDescriptor } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import {
  LocalModelCenterRuntimeView,
  type LocalModelCenterSection,
} from './runtime-config-local-model-center-runtime-view';
import { useLocalModelCenterRuntimeState } from './runtime-config-use-local-model-center-runtime-state';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import { LocalModelCatalogSection } from './runtime-config-local-model-center-catalog';
import type { RuntimeConfigInstallResult } from './runtime-config-panel-controller-install-actions';

export function LocalModelCenter(props: {
  readonly activeSection: LocalModelCenterSection;
  readonly runtimeWritesDisabled: boolean;
  readonly installResolvedModelPlan: (plan: NimiRuntimeLocalInstallPlanDescriptor) => Promise<RuntimeConfigInstallResult>;
}) {
  const commands = useDesktopRendererCommands();
  const runtimeState = useLocalModelCenterRuntimeState();
  const client = useRuntimeConfigLocalEnvironmentClient();
  const catalog = useQuery({
    queryKey: ['runtime-config', 'builtin-catalog'],
    queryFn: () => client.listVerifiedAssets(),
    enabled: props.activeSection === 'discover',
    refetchOnWindowFocus: false,
  });

  return (
    <LocalModelCenterRuntimeView
      activeSection={props.activeSection}
      catalogContent={(
        <LocalModelCatalogSection assets={catalog.data ?? []} loading={catalog.isPending}
          error={catalog.error?.message ?? ''} runtimeWritesDisabled={props.runtimeWritesDisabled}
          onRefresh={() => { void catalog.refetch(); }}
          onInstall={async (templateId) => {
            const plan = await client.resolveInstallPlan({ source: 'verified', templateId });
            if (!plan.installAvailable) throw new Error(plan.warnings.join(' · ') || plan.reasonCode);
            const result = await props.installResolvedModelPlan(plan);
            if (result.status === 'failed') throw result.error;
            if (result.status === 'completed') await runtimeState.refreshInstalledAssets();
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
      observedAtBySessionId={runtimeState.observedAtBySessionId}
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
