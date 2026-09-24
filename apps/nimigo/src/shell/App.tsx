import { RuntimeGate } from './runtime-gate.js';
import { AmbientBackground, NimiToaster } from '@nimiplatform/kit/ui';
import { GoApp } from '../product/GoApp.js';
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
      <RuntimeGate
        appTitle={appTitle}
        copy={targetRuntimeGateCopy}
        resolve={resolveTargetRuntimeGate}
        clear={clearTargetRuntimeGate}
        toErrorMessage={targetRuntimeGateErrorMessage}
      >
        <AmbientBackground variant="mesh" className="app-shell" data-testid="nimi-app-shell">
          <GoApp />
        </AmbientBackground>
      </RuntimeGate>
      <NimiToaster />
    </>
  );
}
