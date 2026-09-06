import {
  createNimiElectronInstalledAppControl,
  NimiElectronInstalledAppError,
  type NimiElectronInstalledAppControl,
} from '@nimiplatform/kit/shell/electron/main';
import type { InstalledAppRun } from '../src/shell/shared/installed-app-types.js';

type Run = { readonly selector: Uint8Array; launchId?: string; pending: boolean; view: InstalledAppRun };
const COMMANDS = ['installed_app_launch', 'installed_app_focus', 'installed_app_stop', 'installed_app_runs_list', 'installed_app_uninstall'] as const;
export type DesktopInstalledAppHost = ReturnType<typeof createDesktopInstalledAppHost>;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
export function createDesktopInstalledAppHost(control: NimiElectronInstalledAppControl = createNimiElectronInstalledAppControl()) {
  const runs = new Map<string, Run>();
  let closing = false;
  const refresh = async (run: Run): Promise<InstalledAppRun> => {
    if (!run.launchId || run.pending) return project(run);
    const id = run.launchId;
    const before = run.view;
    const status = await control.status(id);
    if (run.pending || run.launchId !== id || run.view !== before) return project(run);
    if (!status.running) {
      await control.stop(id);
      await control.end(id).catch(() => undefined);
      if (run.pending || run.launchId !== id || run.view !== before) return project(run);
      run.launchId = undefined;
      run.view = { ...run.view, state: run.view.state === 'stopped' || status.exitCode === null || status.exitCode === 0 ? 'stopped' : 'crashed', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED' };
      return project(run);
    }
    const access = await control.access(id).catch((error: unknown) => ({ available: false, reasonCode: reason(error) }));
    if (run.pending || run.launchId !== id || run.view !== before) return project(run);
    run.view = { ...run.view, state: 'running', accessAvailable: access.available, accessReasonCode: access.reasonCode };
    return project(run);
  };
  const invoke = async (command: typeof COMMANDS[number], payload: Readonly<Record<string, unknown>>): Promise<unknown> => {
    if (command === 'installed_app_runs_list') return Promise.all([...runs.values()].map(refresh));
    const selector = parseSelector(payload, command === 'installed_app_uninstall');
    const key = Buffer.from(selector).toString('base64');
    let run = runs.get(key);
    if (command === 'installed_app_uninstall') {
      if (run?.pending) throw new Error('installed-app-action-pending');
      const jobId = Uint8Array.from((payload.payload as { jobId: number[] }).jobId);
      if (run) run.pending = true;
      try {
        if (run?.launchId) {
          await control.stop(run.launchId);
          run.view = { ...run.view, state: 'stopped', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
          await control.end(run.launchId);
        }
        await control.completeUninstall(jobId, selector);
        runs.delete(key);
        return { uninstalled: true };
      } catch (error) {
        throw new Error(failureMessage(error), { cause: error });
      } finally { if (run) run.pending = false; }
    }
    if (command === 'installed_app_launch') {
      if (closing) throw new Error('installed-app-owner-closing');
      if (run?.pending) return project(run);
      run ??= { selector, pending: false, view: { launchSelector: [...selector], state: 'stopped', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' } };
      run.pending = true;
      runs.set(key, run);
      try {
        if (run.launchId) {
          const status = await control.status(run.launchId);
          if (status.running) {
            run.view = { ...run.view, state: 'running' };
            try { await control.focus(run.launchId); }
            catch (error) { run.view = { ...run.view, reasonCode: reason(error), message: failureMessage(error) }; }
            return project(run);
          }
          await control.stop(run.launchId);
          await control.end(run.launchId);
        }
        run.launchId = undefined;
        run.view = { launchSelector: [...selector], state: 'launching', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
        const launched = await control.launch(selector);
        run.launchId = launched.launchId;
        run.view = { ...run.view, state: 'running' };
      } catch (error) {
        run.view = { ...run.view, state: 'crashed', reasonCode: reason(error), message: failureMessage(error), accessAvailable: false };
      } finally { run.pending = false; }
      return refresh(run);
    }
    if (!run?.launchId) throw new Error('installed-app-run-unavailable');
    if (run.pending) return project(run);
    if (command === 'installed_app_focus') {
      await control.focus(run.launchId);
      return refresh(run);
    }
    run.pending = true;
    try {
      run.view = { ...run.view, state: 'stopping' };
      await control.stop(run.launchId);
      run.view = { ...run.view, state: 'stopped', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
      await control.end(run.launchId);
    } catch (error) {
      const { running } = await control.status(run.launchId);
      run.view = { ...run.view, state: running ? 'running' : 'stopped', message: failureMessage(error), reasonCode: reason(error), accessAvailable: false };
      throw error;
    } finally { run.pending = false; }
    return project(run);
  };
  return {
    resume(): void { closing = false; },
    commandHandlers: Object.fromEntries(COMMANDS.map((command) => [command, (context: { readonly payload: Readonly<Record<string, unknown>> }) => invoke(command, context.payload)])),
    async shutdown(): Promise<void> {
      closing = true;
      for (const run of runs.values()) {
        if (run.pending) throw new Error('installed-app-action-pending');
        if (!run.launchId) continue;
        await control.stop(run.launchId);
        await control.end(run.launchId).catch(() => undefined);
      }
      runs.clear();
    },
  };
}

function parseSelector(value: Readonly<Record<string, unknown>>, uninstall = false): Uint8Array {
  const payload = value.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).sort().join('|') !== (uninstall ? 'jobId|launchSelector' : 'launchSelector')) throw new Error('installed-app-intent-invalid');
  if (uninstall) {
    const jobId = (payload as { jobId: unknown }).jobId;
    if (!Array.isArray(jobId) || jobId.length === 0 || jobId.length > 160 || jobId.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('installed-app-intent-invalid');
  }
  const bytes = (payload as { launchSelector: unknown }).launchSelector;
  if (!Array.isArray(bytes) || bytes.length === 0 || bytes.length > 160 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('installed-app-intent-invalid');
  return Uint8Array.from(bytes);
}
function project(run: Run): InstalledAppRun { return { ...run.view, launchSelector: [...run.selector] }; }
function reason(error: unknown): string { return error instanceof NimiElectronInstalledAppError ? error.reasonCode : 'installed-app-launch-failed'; }
function failureMessage(error: unknown): string {
  if (!(error instanceof NimiElectronInstalledAppError)) return reason(error);
  return [error.reasonCode, ...['native_operation', 'native_error_code', 'runtime_reason_code', 'policy_reason', 'policy_revision'].flatMap((key) => error.reasonMetadata[key] ? [`${key}=${error.reasonMetadata[key]}`] : [])].join(' · ');
}
