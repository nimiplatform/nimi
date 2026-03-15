import type { RefObject } from 'react';
import type { CapabilityOption } from './runtime-config-model-center-utils';
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
  importFileCapability: CapabilityOption;
  onHealthCheck: () => void;
  onRefresh: () => void;
  onToggleImportMenu: () => void;
  onOpenImportFile: () => void;
  onImportManifest: () => void;
  onImportArtifactManifest: () => void;
  onCapabilityChange: (capability: CapabilityOption) => void;
  onCloseImportFileDialog: () => void;
  onChooseImportFile: () => void;
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
        onToggleImportMenu={props.onToggleImportMenu}
        onOpenImportFile={props.onOpenImportFile}
        onImportManifest={props.onImportManifest}
        onImportArtifactManifest={props.onImportArtifactManifest}
      />
      <LocalModelCenterImportDialog
        visible={props.showImportFileDialog}
        capability={props.importFileCapability}
        onCapabilityChange={props.onCapabilityChange}
        onClose={props.onCloseImportFileDialog}
        onChooseFile={props.onChooseImportFile}
      />
    </>
  );
}
