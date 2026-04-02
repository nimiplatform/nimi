import type { RefObject } from 'react';
import type { LocalRuntimeAssetKind } from '@runtime/local-runtime';
import type {
  AssetEngineOption,
} from './runtime-config-model-center-utils';
import {
  LocalModelCenterImportDialog,
  LocalModelCenterToolbar,
} from './runtime-config-local-model-center-sections';

type LocalModelCenterImportControlsProps = {
  checkingHealth: boolean;
  localHealthy: boolean;
  lastCheckedAt?: string | null | undefined;
  discovering: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  showImportFileDialog: boolean;
  importFileAssetKind: LocalRuntimeAssetKind;
  importFileAuxiliaryEngine: AssetEngineOption | '';
  importFileEndpoint: string;
  importEndpointRequired: boolean;
  importCompatibilityHint?: string;
  importEndpointHint?: string;
  onHealthCheck: () => void;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onOpenImportFile: () => void;
  onImportManifest: () => void;
  onAssetKindChange: (kind: LocalRuntimeAssetKind) => void;
  onAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onEndpointChange: (endpoint: string) => void;
  onCloseImportFileDialog: () => void;
  onChooseImportFile: () => void;
  canChooseImportFile: boolean;
};

export function LocalModelCenterImportControls(props: LocalModelCenterImportControlsProps) {
  return (
    <>
      <LocalModelCenterToolbar
        checkingHealth={props.checkingHealth}
        localHealthy={props.localHealthy}
        lastCheckedAt={props.lastCheckedAt ?? null}
        discovering={props.discovering}
        importMenuRef={props.importMenuRef}
        showImportMenu={props.showImportMenu}
        onHealthCheck={props.onHealthCheck}
        onRefresh={props.onRefresh}
        onOpenModelsFolder={props.onOpenModelsFolder}
        onToggleImportMenu={props.onToggleImportMenu}
        onOpenImportFile={props.onOpenImportFile}
        onImportManifest={props.onImportManifest}
      />
      <LocalModelCenterImportDialog
        visible={props.showImportFileDialog}
        assetKind={props.importFileAssetKind}
        auxiliaryEngine={props.importFileAuxiliaryEngine}
        endpoint={props.importFileEndpoint}
        endpointRequired={props.importEndpointRequired}
        compatibilityHint={props.importCompatibilityHint}
        endpointHint={props.importEndpointHint}
        onAssetKindChange={props.onAssetKindChange}
        onAuxiliaryEngineChange={props.onAuxiliaryEngineChange}
        onEndpointChange={props.onEndpointChange}
        onClose={props.onCloseImportFileDialog}
        onChooseFile={props.onChooseImportFile}
        canChooseFile={props.canChooseImportFile}
      />
    </>
  );
}
