// Current Desktop Apps bridge.
//
// Public catalog distribution and ordinary-user lifecycle are deferred.
// The current Apps surface consumes only Runtime-mediated local-development
// registrations through the standard protected shell bridge.

import {
  listLocalDevelopmentRegistrations,
  type LocalDevelopmentRegistration,
} from '../local-development/local-development-bridge.js';

export interface DesktopAppsLiveBridge {
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
}

export function createDesktopAppsLiveBridge(): DesktopAppsLiveBridge {
  return {
    listRegistrations: listLocalDevelopmentRegistrations,
  };
}
