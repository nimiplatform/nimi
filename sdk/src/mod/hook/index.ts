import type { HookClient } from '../types';
import { createActionClient } from './action-client';
import { createAuditClient, createMetaClient } from './meta-client';
import { createEventClient } from './event-client';
import { createDataClient } from './data-client';
import { createStorageClient } from './storage-client';
import { createTurnClient } from './turn-client';
import { createUiClient } from './ui-client';
import { createInterModClient } from './inter-mod-client';
import { createProfileClient } from './profile-client';
import { getHookRuntimes, normalizeHookModId } from './shared';
import type { ModRuntimeContextInput } from '../types/runtime-mod';

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
