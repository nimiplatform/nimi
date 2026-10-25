import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

// @nimi-authority: rule.nimi.runtime.protected-session.r017
export async function recoverRuntimeAppSession(input: {
  lifecycle: Pick<DesktopRendererLifecyclePort,
    'auth' | 'invalidateQueries' | 'clearAgentConversationAnchorBindings'>;
  readStatus: () => Promise<{ sessionBound: boolean; reasonCode: string }>;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const account = input.lifecycle.auth();
  if (account.status !== 'authenticated' || !account.user?.id || !input.isCurrent()) return false;
  // Only the technical status probe may cross a rebind. Never replay a
  // conversation send or configuration write from the expired scope.
  const status = await input.readStatus();
  if (!input.isCurrent()) return false;
  const current = input.lifecycle.auth();
  if (current.status !== 'authenticated'
    || current.user?.id !== account.user.id
    || current.user?.realmEnvironmentId !== account.user.realmEnvironmentId
    || current.authorizationRevision !== account.authorizationRevision) return false;
  if (!status.sessionBound) throw new Error(`App session unavailable: ${status.reasonCode}`);
  input.lifecycle.clearAgentConversationAnchorBindings();
  // Refetch mounted read projections, including App AIConfig and fresh Agent
  // handles. The query cache does not restore old session authority.
  logRendererEvent({
    level: 'info',
    area: 'runtime-app-session-recovery',
    message: 'phase:read-projections:invalidate',
    details: { reason: 'session-recovery', atUnixMs: Date.now() },
  });
  await input.lifecycle.invalidateQueries([[]]);
  const completed = input.lifecycle.auth();
  return input.isCurrent() && completed.status === 'authenticated'
    && completed.user?.id === account.user.id
    && completed.user?.realmEnvironmentId === account.user.realmEnvironmentId
    && completed.authorizationRevision === account.authorizationRevision;
}
