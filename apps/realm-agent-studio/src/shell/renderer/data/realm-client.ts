import { getStudioPlatformClient } from '@renderer/app-shell/studio-platform.js';

export function createStudioRealmClient() {
  return getStudioPlatformClient().realm;
}
