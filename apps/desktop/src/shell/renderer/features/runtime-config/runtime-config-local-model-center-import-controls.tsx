import type { RefObject } from 'react';
import type { LocalRuntimeAssetKind } from '@runtime/local-runtime';
import type {
  AssetClassOption,
  AssetEngineOption,
  ModelTypeOption,
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
  importFileAssetClass: AssetClassOption;
  importFileModelType: ModelTypeOption;
  importFileDependencyKind: LocalRuntimeAssetKind;
  importFileAuxiliaryEngine: AssetEngineOption | '';
  onHealthCheck: () => void;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onOpenImportFile: () => void;
  onImportManifest: () => void;
  onAssetClassChange: (assetClass: AssetClassOption) => void;
  onModelTypeChange: (modelType: ModelTypeOption) => void;
  onDependencyKindChange: (kind: LocalRuntimeAssetKind) => void;
  onAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
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
        assetClass={props.importFileAssetClass}
        modelType={props.importFileModelType}
        dependencyKind={props.importFileDependencyKind}
        auxiliaryEngine={props.importFileAuxiliaryEngine}
        onAssetClassChange={props.onAssetClassChange}
        onModelTypeChange={props.onModelTypeChange}
        onDependencyKindChange={props.onDependencyKindChange}
        onAuxiliaryEngineChange={props.onAuxiliaryEngineChange}
        onClose={props.onCloseImportFileDialog}
        onChooseFile={props.onChooseImportFile}
        canChooseFile={props.canChooseImportFile}
      />
    </>
  );
}
