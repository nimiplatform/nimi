import type { ReactElement } from 'react';
import {
  projectNimiProductControlFirstRunScreen,
  type NimiProductControlRecordProjection,
  type NimiProductControlState,
} from '@nimiplatform/sdk/runtime';

import { FirstRunReconcilingScreen } from './first-run-reconciling-screen.js';
import { PhaseStorage } from './phase-storage.js';
import { ScreenBlocked, ScreenReady, ScreenRepair } from './screen-terminal.js';

type FirstRunScreenProjection = ReturnType<typeof projectNimiProductControlFirstRunScreen>;

type ProductControlWorkflowScreenProps = {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onChangeDataRootFolder: () => void;
  readonly onChooseDataRootFolder: () => void;
  readonly onConfirmDataRoot: () => void;
  readonly onRequestAdmission: () => void;
  readonly pickedPath: string | null;
  readonly projection: NimiProductControlRecordProjection | null;
  readonly screen: FirstRunScreenProjection;
  readonly state: NimiProductControlState;
  readonly storageTransient: boolean;
};

export function ProductControlWorkflowScreen(props: ProductControlWorkflowScreenProps): ReactElement {
  if (props.screen.kind === 'terminal') {
    if (props.screen.screen === 'login') {
      return <FirstRunReconcilingScreen productState={props.state} />;
    }
    if (props.screen.screen === 'repair') {
      return (
        <ScreenRepair
          reason={props.projection?.record?.repair.reason ?? props.error}
          busy={props.busy}
          onRetry={props.onRequestAdmission}
        />
      );
    }
    if (props.screen.screen === 'blocked') {
      return <ScreenBlocked reason={props.error} />;
    }
    return <ScreenReady />;
  }

  return (
    <PhaseStorage
      transient={props.storageTransient}
      mode={props.state === 'data_root_selected' ? 'selected' : 'missing'}
      pickedPath={props.pickedPath}
      busy={props.busy}
      onChooseFolder={props.onChooseDataRootFolder}
      onChangeFolder={props.onChangeDataRootFolder}
      onRetry={props.onRequestAdmission}
      onContinue={props.state === 'data_root_selected'
        ? props.onRequestAdmission
        : props.onConfirmDataRoot}
    />
  );
}
