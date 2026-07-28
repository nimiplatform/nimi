// Current Desktop Apps bridge.
//
// Public catalog distribution and ordinary-user lifecycle are deferred.
// The current Apps surface consumes only Runtime-mediated local-development
// authorizations through the standard protected shell bridge.

import {
  listLocalDevelopmentAuthorizations,
  type LocalDevelopmentAuthorization,
} from '../local-development/local-development-bridge.js';

export interface DesktopAppsLiveBridge {
  listAuthorizations(): Promise<readonly LocalDevelopmentAuthorization[]>;
}

export function createDesktopAppsLiveBridge(): DesktopAppsLiveBridge {
  return {
    listAuthorizations: listLocalDevelopmentAuthorizations,
  };
}
