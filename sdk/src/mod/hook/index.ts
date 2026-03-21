import type { HookClient } from '../types/index.js';
import { createActionClient } from './action-client.js';
import { createAuditClient, createMetaClient } from './meta-client.js';
import { createEventClient } from './event-client.js';
import { createDataClient } from './data-client.js';
import { createStorageClient } from './storage-client.js';
import { createTurnClient } from './turn-client.js';
import { createUiClient } from './ui-client.js';
import { createInterModClient } from './inter-mod-client.js';
import { createProfileClient } from './profile-client.js';
import { getHookRuntimes, normalizeHookModId } from './shared.js';
import type { ModRuntimeContextInput } from '../types/runtime-mod.js';

export function createHookClient(modId: string, context?: ModRuntimeContextInput): HookClient {
  const normalizedModId = normalizeHookModId(modId);
  const { runtimeHost, runtime } = getHookRuntimes(context);

  return {
    action: createActionClient({
      modId: normalizedModId,
      runtime,
    }),
    event: createEventClient({
      modId: normalizedModId,
      runtime,
    }),
    data: createDataClient({
      modId: normalizedModId,
      runtime,
    }),
    storage: createStorageClient({
      modId: normalizedModId,
      runtime,
    }),
    turn: createTurnClient({
      modId: normalizedModId,
      runtime,
    }),
    ui: createUiClient({
      modId: normalizedModId,
      runtime,
    }),
    interMod: createInterModClient({
      modId: normalizedModId,
      runtime,
    }),
    profile: createProfileClient({
      modId: normalizedModId,
      runtime,
    }),
    audit: createAuditClient({
      modId: normalizedModId,
      runtime,
    }),
    meta: createMetaClient({
      modId: normalizedModId,
      runtime,
    }),
  };
}
