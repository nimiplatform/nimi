import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';

// @nimi-authority: rule.nimi.runtime.protected-session.r017
export async function recoverRuntimeAppSession(input: {
  lifecycle: Pick<DesktopRendererLifecyclePort,
    'auth' | 'invalidateQueries' | 'clearAgentConversationAnchorBindings'>;
  readStatus: () => Promise<{ sessionBound: boolean; reasonCode: string }>;
  isCurrent: () => boolean;
}): Promise<void> {
  const account = input.lifecycle.auth();
  if (account.status !== 'authenticated' || !account.user?.id || !input.isCurrent()) return;
  // Only the technical status probe may cross a rebind. Never replay a
  // conversation send or configuration write from the expired scope.
  const status = await input.readStatus();
  if (!input.isCurrent()) return;
  const current = input.lifecycle.auth();
  if (current.status !== 'authenticated'
    || current.user?.id !== account.user.id
    || current.user?.realmEnvironmentId !== account.user.realmEnvironmentId) return;
  if (!status.sessionBound) throw new Error(`App session unavailable: ${status.reasonCode}`);
  input.lifecycle.clearAgentConversationAnchorBindings();
  // Refetch mounted read projections, including App AIConfig and fresh Agent
  // handles. The query cache does not restore old session authority.
  await input.lifecycle.invalidateQueries([[]]);
}
