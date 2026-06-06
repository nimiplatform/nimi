import type { ReactElement } from 'react';
import { projectNimiProductControlFirstRunScreen } from '@nimiplatform/sdk/runtime';
import type { NimiFirstRunInstallLevel } from '@nimiplatform/sdk/app';
import type { NimiProductControlRecordProjection, NimiProductControlState } from '@renderer/bridge';
import { FirstRunFinalization } from './first-run-finalization.js';
import type { FirstRunInstallLevelCard } from './first-run-install-level-cards.js';
import type { FirstRunSetupChecklist } from './first-run-setup-checklist.js';
import { FirstRunReconcilingScreen } from './first-run-reconciling-screen.js';
import { PhaseDeviceScan } from './phase-device-scan.js';
import { PhaseLocalAi } from './phase-local-ai.js';
import { PhaseSetup } from './phase-setup.js';
import { PhaseStorage } from './phase-storage.js';
import type { NimiFirstRunMaterializationDependencyProjection } from './runtime-materialization.js';
import { ScreenBlocked, ScreenReady, ScreenRepair } from './screen-terminal.js';

type FirstRunScreenProjection = ReturnType<typeof projectNimiProductControlFirstRunScreen>;

type ProductControlWorkflowScreenProps = {
  busy: boolean;
  deviceScanSettled: boolean;
  deviceSummary: string | null;
  draftInstallLevel: NimiFirstRunInstallLevel | null;
  error: string | null;
  installLevelCards: {
    readonly minimal: FirstRunInstallLevelCard;
    readonly recommended: FirstRunInstallLevelCard;
  };
  materializationReadyForFinalization: boolean;
  onCancelSetupStep: (item: NimiFirstRunMaterializationDependencyProjection) => void;
  onChangeDataRootFolder: () => void;
  onChooseDataRootFolder: () => void;
  onConfirmDataRoot: () => void;
  onContinueFromDeviceScan: () => void;
  onContinueFromLocalAi: () => void;
  onProjectionChange: (projection: NimiProductControlRecordProjection) => void;
  onReevaluateProductControl: () => void;
  onRepairSetupStep: (item: NimiFirstRunMaterializationDependencyProjection) => void;
  onRetryDeviceScan: () => void;
  onRetrySetupStep: (item: NimiFirstRunMaterializationDependencyProjection) => void;
  onSelectInstallLevel: (installLevel: NimiFirstRunInstallLevel) => void;
  pickedPath: string | null;
  projection: NimiProductControlRecordProjection | null;
  screen: FirstRunScreenProjection;
  selectedDataRoot: string | null;
  setupChecklist: FirstRunSetupChecklist;
  state: NimiProductControlState;
  storageTransient: boolean;
};

export function ProductControlWorkflowScreen(props: ProductControlWorkflowScreenProps): ReactElement {
  if (props.screen.kind === 'terminal') {
    if (props.screen.screen === 'login') {
      return <FirstRunReconcilingScreen productState={props.state} />;
    }
    if (props.screen.screen === 'repair') {
      return (
        <ScreenRepair
          reason={props.projection?.record?.repair.reason ?? props.projection?.error ?? null}
          busy={props.busy}
          onRetry={props.onReevaluateProductControl}
        />
      );
    }
    if (props.screen.screen === 'blocked') {
      return <ScreenBlocked reason={props.projection?.error ?? null} />;
    }
    return <ScreenReady />;
  }

  if (props.screen.phase === 'storage') {
    return (
      <PhaseStorage
        transient={props.storageTransient}
        pickedPath={props.pickedPath}
        busy={props.busy}
        onChooseFolder={props.onChooseDataRootFolder}
        onContinue={props.onConfirmDataRoot}
      />
    );
  }

  if (props.screen.phase === 'device-scan') {
    return (
      <PhaseDeviceScan
        deviceSummary={props.deviceSummary}
        deviceScanPending={!props.deviceScanSettled}
        dataRootPath={props.selectedDataRoot}
        busy={props.busy}
        onRetry={props.onRetryDeviceScan}
        onChangeDataRoot={props.onChangeDataRootFolder}
        onContinue={props.onContinueFromDeviceScan}
      />
    );
  }

  if (props.screen.phase === 'local-ai') {
    return (
      <PhaseLocalAi
        cards={props.installLevelCards}
        selected={props.draftInstallLevel}
        deviceSummary={props.deviceSummary}
        deviceScanPending={!props.deviceScanSettled}
        dataRootPath={props.selectedDataRoot}
        busy={props.busy}
        onSelect={props.onSelectInstallLevel}
        onChangeDataRoot={props.onChangeDataRootFolder}
        onContinue={props.onContinueFromLocalAi}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PhaseSetup
        checklist={props.setupChecklist}
        busy={props.busy}
        error={props.error}
        actions={{
          onRetry: props.onRetrySetupStep,
          onRepair: props.onRepairSetupStep,
          onCancel: props.onCancelSetupStep,
        }}
      />
      {(props.state === 'local_ai_ready' || props.materializationReadyForFinalization) && props.projection ? (
        <FirstRunFinalization projection={props.projection} onProjectionChange={props.onProjectionChange} />
      ) : null}
    </div>
  );
}
