import { getTargetAppSession } from '../workbench-target-adapter.js';
export { appId, appTitle, scaffoldProfile } from './app-identity.js';

export async function getRuntimePlatformProjection() {
  const snapshot = getTargetAppSession().getSnapshot();
  if (snapshot.runtime.status === 'connected') return { status: 'ready' as const, mode: 'local-app' as const };
  return { status: 'unavailable' as const, mode: 'local-app' as const,
    reasonCode: snapshot.issue?.reasonCode ?? 'KIT_APP_CONNECTION_UNAVAILABLE',
    message: snapshot.issue?.message ?? 'Open Nimi Home to check your account and App access.' };
}
