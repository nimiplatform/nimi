import type { RefObject } from 'react';
import type {
  NimiRuntimeLocalTransferProgressEvent,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { ScrollArea } from '@nimiplatform/kit/ui';

import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { LocalModelCenterImportControls } from './runtime-config-local-model-center-import-controls';
import { LocalModelCenterInstalledAssetsSection } from './runtime-config-local-model-center-installed-section';
import { LocalModelCenterInProgressSection } from './runtime-config-local-model-center-progress-sections';
import { RUNTIME_PAGE_WIDTH_CLASS, RuntimePageHeader } from './runtime-config-page-shell';

type LocalAssetsRuntimeViewProps = {
  readonly assetBusy: boolean;
  readonly assetImportError: string;
  readonly loadingInstalledAssets: boolean;
  readonly modelAssets: readonly NimiRuntimeModelAssetRecord[];
  readonly runtimeInventoryError: string;
  readonly importMenuRef: RefObject<HTMLDivElement | null>;
  readonly showImportMenu: boolean;
  readonly runtimeWritesDisabled: boolean;
  readonly downloads: readonly NimiRuntimeLocalTransferProgressEvent[];
  readonly imports: readonly NimiRuntimeLocalTransferProgressEvent[];
  readonly terminalDownloads: readonly NimiRuntimeLocalTransferProgressEvent[];
  readonly terminalImports: readonly NimiRuntimeLocalTransferProgressEvent[];
  readonly onCancelDownload: (installSessionId: string) => void;
  readonly onDismissImportError: () => void;
  readonly onDismissSession: (installSessionId: string) => void;
  readonly onImportFile: () => Promise<unknown>;
  readonly onImportDirectory: () => Promise<unknown>;
  readonly onInspectRemoval: (modelAssetId: string) => Promise<string[]>;
  readonly onOpenModelsFolder: () => void;
  readonly onPauseDownload: (installSessionId: string) => void;
  readonly onRefreshAssets: () => void;
  readonly onRemoveAsset: (modelAssetId: string) => Promise<void>;
  readonly onResumeDownload: (installSessionId: string) => void;
  readonly onToggleImportMenu: () => void;
};

export function LocalModelCenterRuntimeView(props: LocalAssetsRuntimeViewProps) {
  const i18n = useDesktopI18nResource().instance;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName={`mx-auto ${RUNTIME_PAGE_WIDTH_CLASS} space-y-4 px-4 pb-4`}>
        <RuntimePageHeader
          title={i18n.t('runtimeConfig.sidebar.localAssets', { defaultValue: 'Local Assets' })}
          actions={(
            <LocalModelCenterImportControls
              refreshing={props.loadingInstalledAssets}
              importMenuRef={props.importMenuRef}
              showImportMenu={props.showImportMenu}
              runtimeWritesDisabled={props.runtimeWritesDisabled}
              onRefresh={props.onRefreshAssets}
              onOpenModelsFolder={props.onOpenModelsFolder}
              onToggleImportMenu={props.onToggleImportMenu}
              onImportFile={props.onImportFile}
              onImportDirectory={props.onImportDirectory}
            />
          )}
        />
        {props.runtimeInventoryError ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
            {props.runtimeInventoryError}
          </div>
        ) : null}
        {props.assetImportError ? (
          <div className="flex items-start justify-between gap-2 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
            <span>{props.assetImportError}</span>
            <button
              type="button"
              aria-label={i18n.t('runtimeConfig.localModelCenter.dismissImportError', { defaultValue: 'Dismiss import error' })}
              className="rounded-md px-1.5 py-0.5 text-xs text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]"
              onClick={props.onDismissImportError}
            >
              {'\u00d7'}
            </button>
          </div>
        ) : null}
        <LocalModelCenterInProgressSection
          downloads={[...props.downloads]}
          imports={[...props.imports]}
          terminalDownloads={[...props.terminalDownloads]}
          terminalImports={[...props.terminalImports]}
          runtimeWritesDisabled={props.runtimeWritesDisabled}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
          onDismiss={props.onDismissSession}
        />
        <LocalModelCenterInstalledAssetsSection
          modelAssets={[...props.modelAssets]}
          loadingInstalledAssets={props.loadingInstalledAssets}
          assetBusy={props.assetBusy}
          runtimeWritesDisabled={props.runtimeWritesDisabled}
          onRefreshAssets={props.onRefreshAssets}
          onInspectRemoval={props.onInspectRemoval}
          onRemoveAsset={props.onRemoveAsset}
        />
      </ScrollArea>
    </div>
  );
}
