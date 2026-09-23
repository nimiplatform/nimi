import type {
  NimiElectronAppActivitySourceLaunchResult,
  RegisteredNimiElectronRuntimeBridge,
} from '@nimiplatform/kit/shell/electron/main';

type ResolvedLaunchTarget = Awaited<ReturnType<NonNullable<RegisteredNimiElectronRuntimeBridge['resolveAppActivityOpenLaunch']>>>;

export type DesktopAppActivitySourceLaunch = (openRequestId: string) => Promise<NimiElectronAppActivitySourceLaunchResult>;

// @nimi-authority: rule.nimi.desktop.bridge-ipc.r022
/**
 * Launches or focuses the exact source of one Runtime-issued App activity open
 * request. The source is resolved through Desktop's formal Runtime session and
 * handed to the existing installed or local-development Host owner; the source
 * App's own confirmation remains the only opened signal.
 */
export function createDesktopAppActivitySourceLaunch(input: {
  readonly isAvailable?: () => boolean;
  readonly resolve: () => ((openRequestId: string) => Promise<ResolvedLaunchTarget>) | undefined;
  readonly launchInstalled: () => ((launchSelector: Uint8Array) => Promise<unknown>) | undefined;
  readonly startLocalDevelopment: () => ((registrationHandle: string) => Promise<boolean>) | undefined;
}): DesktopAppActivitySourceLaunch {
  return async (openRequestId) => {
    if (input.isAvailable && !input.isAvailable()) return { status: 'unavailable', reason: 'host-unavailable' };
    const resolve = input.resolve();
    if (!resolve) return { status: 'unavailable', reason: 'host-unavailable' };
    let target: ResolvedLaunchTarget;
    try {
      target = await resolve(openRequestId);
    } catch {
      return { status: 'failed', reason: 'launch-failed' };
    }
    try {
      if (target.sourceClass === 'installed') {
        const launchInstalled = input.launchInstalled();
        if (!launchInstalled) return { status: 'unavailable', reason: 'host-unavailable' };
        const run = await launchInstalled(target.launchSelector) as { readonly state?: unknown } | undefined;
        return run?.state === 'running' || run?.state === 'launching'
          ? { status: 'requested' }
          : { status: 'failed', reason: 'launch-failed' };
      }
      const startLocalDevelopment = input.startLocalDevelopment();
      if (!startLocalDevelopment) return { status: 'unavailable', reason: 'host-unavailable' };
      const started = await startLocalDevelopment(Buffer.from(target.launchSelector).toString('hex'));
      return started ? { status: 'requested' } : { status: 'unavailable', reason: 'source-unavailable' };
    } catch {
      return { status: 'failed', reason: 'launch-failed' };
    }
  };
}
