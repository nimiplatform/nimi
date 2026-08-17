import type { RefObject } from 'react';
import { LocalModelCenterToolbar } from './runtime-config-local-model-center-sections';

type LocalModelCenterImportControlsProps = {
  checkingHealth: boolean;
  lastCheckedAt?: string | null | undefined;
  refreshing: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  onHealthCheck: () => void;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onImportFile: () => Promise<unknown>;
  onImportDirectory: () => Promise<unknown>;
};

export function LocalModelCenterImportControls(props: LocalModelCenterImportControlsProps) {
  return (
    <LocalModelCenterToolbar
      checkingHealth={props.checkingHealth}
      lastCheckedAt={props.lastCheckedAt ?? null}
      refreshing={props.refreshing}
      importMenuRef={props.importMenuRef}
      showImportMenu={props.showImportMenu}
      onHealthCheck={props.onHealthCheck}
      onRefresh={props.onRefresh}
      onOpenModelsFolder={props.onOpenModelsFolder}
      onToggleImportMenu={props.onToggleImportMenu}
      onImportFile={props.onImportFile}
      onImportDirectory={props.onImportDirectory}
    />
  );
}
