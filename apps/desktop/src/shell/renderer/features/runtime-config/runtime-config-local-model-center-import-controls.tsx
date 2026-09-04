import type { RefObject } from 'react';
import { LocalModelCenterToolbar } from './runtime-config-local-model-center-sections';

type LocalModelCenterImportControlsProps = {
  refreshing: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  runtimeWritesDisabled: boolean;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onImportFile: () => Promise<unknown>;
  onImportDirectory: () => Promise<unknown>;
};

export function LocalModelCenterImportControls(props: LocalModelCenterImportControlsProps) {
  return (
    <LocalModelCenterToolbar
      refreshing={props.refreshing}
      importMenuRef={props.importMenuRef}
      showImportMenu={props.showImportMenu}
      runtimeWritesDisabled={props.runtimeWritesDisabled}
      onRefresh={props.onRefresh}
      onOpenModelsFolder={props.onOpenModelsFolder}
      onToggleImportMenu={props.onToggleImportMenu}
      onImportFile={props.onImportFile}
      onImportDirectory={props.onImportDirectory}
    />
  );
}
