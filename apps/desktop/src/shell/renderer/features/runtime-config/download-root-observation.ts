import type { DesktopRendererFirstRunPort } from '../../renderer/first-run-port.js';

/** Read-only download observation still brackets the list with an active-root check. */
export async function readDownloadRootActivation(firstRun: Pick<DesktopRendererFirstRunPort, 'getSelectedDataRoot'>): Promise<string> {
  const projection = await firstRun.getSelectedDataRoot();
  const root = projection.dataRoot;
  if (projection.error || projection.state !== 'ready_for_use'
    || root?.status !== 'ready' || !root.rootActivationId || !projection.hostProfileScopeRoot) {
    throw new Error(projection.error ?? 'Download state is unavailable until the data root is ready');
  }
  return root.rootActivationId;
}
