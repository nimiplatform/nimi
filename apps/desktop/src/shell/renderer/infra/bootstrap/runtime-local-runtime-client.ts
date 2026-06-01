import { getPlatformClient } from '@nimiplatform/sdk';
import {
  bindLocalRuntimeClientWarningListener,
  bindLocalRuntimeServiceClientProvider,
} from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';

let installed = false;

export function installDesktopLocalRuntimeClientBindings(): void {
  if (installed) {
    return;
  }
  installed = true;
  bindLocalRuntimeServiceClientProvider(() => {
    try {
      return getPlatformClient().runtime.local;
    } catch {
      return null;
    }
  });
  bindLocalRuntimeClientWarningListener((warning) => {
    emitRuntimeLog(warning);
  });
}
