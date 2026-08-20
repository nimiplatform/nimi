import { WorkbenchRuntimeGate } from '../workbench-core/index.js';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { AuthenticatedShell } from './authenticated-shell.js';
import {
  appTitle,
  clearTargetRuntimeGate,
  resolveTargetRuntimeGate,
  targetRuntimeGateCopy,
  targetRuntimeGateErrorMessage,
} from './workbench-target-adapter.js';

export function App() {
  return (
    <>
      <WorkbenchRuntimeGate
        appTitle={appTitle}
        copy={targetRuntimeGateCopy}
        resolve={resolveTargetRuntimeGate}
        clear={clearTargetRuntimeGate}
        toErrorMessage={targetRuntimeGateErrorMessage}
      >
        <AuthenticatedShell />
      </WorkbenchRuntimeGate>
      <NimiToaster />
    </>
  );
}
