import { NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY } from './app-host-profile.js';
import { NimiElectronShellHostError } from './types.js';

/** Consumed only from the exit status of an exact Desktop-owned child. */
export const NIMI_APP_HOST_RESTART_EXIT_CODE = 75;
export const NIMI_APP_HOST_RESTART_SUPPORT_ENVIRONMENT_KEY = 'NIMI_APP_HOST_RESTART_SUPPORTED';

export type NimiElectronAppExitTarget = {
  quit(): void;
  exit(code: number): void;
};

export type NimiElectronAppExitController = {
  readonly requestRestart: () => void;
  readonly exit: (code?: number) => void;
};

/** The App keeps its graceful business teardown; Desktop performs the next launch. */
// @nimi-authority: definition.nimi.platform.app-ecosystem.app-host-restart-request
export function createNimiElectronAppExitController(
  app: NimiElectronAppExitTarget,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): NimiElectronAppExitController {
  let requestedExitCode = 0;
  return Object.freeze({
    requestRestart() {
      if (environment[NIMI_APP_HOST_RESTART_SUPPORT_ENVIRONMENT_KEY] !== '1'
        || !environment[NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]) {
        throw new NimiElectronShellHostError({
          code: 'capability-unavailable',
          message: 'This Host cannot request a supervised restart.',
          reasonCode: 'electron-app-restart-unavailable',
          actionHint: 'restart_through_nimi_desktop',
        });
      }
      requestedExitCode = NIMI_APP_HOST_RESTART_EXIT_CODE;
      app.quit();
    },
    exit(code = 0) {
      app.exit(code === 0 ? requestedExitCode : code);
    },
  });
}
