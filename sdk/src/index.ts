export { asNimiError } from './runtime/errors.js';
export type { NimiError, VersionCompatibilityStatus } from './types/index.js';
export { ReasonCode, isRetryableReasonCode } from './types/index.js';
export {
  createPlatformClient,
  createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient,
  clearPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from './platform-client.js';
export type { PlatformClient, PlatformClientInput, PlatformAuthSessionStore } from './platform-client.js';
export { withRealmContextLock } from './realm/context-lock.js';
export type { RealmContextInput } from './realm/context-lock.js';
