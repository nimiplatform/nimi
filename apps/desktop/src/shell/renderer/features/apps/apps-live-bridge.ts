// Current Desktop Apps bridge.
//
// This first live slice consumes Runtime-mediated local-development
// registrations and Desktop-owned supervised run state through the standard
// protected shell bridge. Immutable package inventory joins this bridge only
// when the Runtime package lifecycle owner is available.

import {
  listLocalDevelopmentRegistrations,
  listLocalDevelopmentRuns,
  removeLocalDevelopmentRegistration,
  startLocalDevelopmentRegistration,
  stopLocalDevelopmentRun,
  type LocalDevelopmentRegistration,
  type LocalDevelopmentRun,
} from '../local-development/local-development-bridge.js';

export interface DesktopAppsLiveBridge {
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
  listRuns(): Promise<readonly LocalDevelopmentRun[]>;
  startRegistration(selector: string): Promise<LocalDevelopmentRun>;
  stopRun(appId: string): Promise<void>;
  removeRegistration(selector: string): Promise<void>;
}

export function createDesktopAppsLiveBridge(): DesktopAppsLiveBridge {
  return {
    listRegistrations: listLocalDevelopmentRegistrations,
    listRuns: listLocalDevelopmentRuns,
    startRegistration: startLocalDevelopmentRegistration,
    stopRun: stopLocalDevelopmentRun,
    removeRegistration: removeLocalDevelopmentRegistration,
  };
}
