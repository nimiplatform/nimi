import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { getTargetAppSession } from '../workbench-target-adapter.js';

export function getNimiLocalAppClient(): NimiLocalAppClient {
  const runtime = getTargetAppSession().getSnapshot().runtime;
  if (runtime.status !== 'connected') throw new Error('Connect through Nimi Home before starting work.');
  runtime.scope.signal.throwIfAborted();
  return runtime.scope.client;
}
