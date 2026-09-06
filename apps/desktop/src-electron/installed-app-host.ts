import {
  createNimiElectronInstalledAppControl,
  NimiElectronInstalledAppError,
  type NimiElectronInstalledAppControl,
} from '@nimiplatform/kit/shell/electron/main';
import type { InstalledAppRun } from '../src/shell/shared/installed-app-types.js';

type Run = { readonly selector: Uint8Array; launchId?: string; exitState?: 'stopped' | 'crashed'; pending: boolean; view: InstalledAppRun };
const COMMANDS = ['installed_app_launch', 'installed_app_focus', 'installed_app_stop', 'installed_app_runs_list', 'installed_app_uninstall'] as const;
export type DesktopInstalledAppHost = ReturnType<typeof createDesktopInstalledAppHost>;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
export function createDesktopInstalledAppHost(control: NimiElectronInstalledAppControl = createNimiElectronInstalledAppControl()) {
  const runs = new Map<string, Run>();
  let closing = false;
  const releaseLease = async (run: Run, id: string): Promise<void> => {
    await control.end(id);
    if (run.launchId === id) run.launchId = undefined;
  };
  const refresh = async (run: Run): Promise<InstalledAppRun> => {
    if (!run.launchId || run.pending) return project(run);
    const id = run.launchId;
    const before = run.view;
    if (!run.exitState) {
      const status = await control.status(id);
      if (run.pending || run.launchId !== id || run.view !== before) return project(run);
      if (status.running) {
        const access = await control.access(id).catch((error: unknown) => ({ available: false, reasonCode: reason(error) }));
        if (run.pending || run.launchId !== id || run.view !== before) return project(run);
        run.view = { ...run.view, state: 'running', accessAvailable: access.available, accessReasonCode: access.reasonCode };
        return project(run);
      }
      run.exitState = run.view.state === 'stopped' || status.exitCode === null || status.exitCode === 0 ? 'stopped' : 'crashed';
      run.view = { ...run.view, state: run.exitState, accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED' };
    }
    const exited = run.view;
    try {
      await control.stop(id);
      await releaseLease(run, id);
      if (!run.pending && run.view === exited) run.view = { ...exited, message: '', reasonCode: undefined };
    } catch (error) {
      if (!run.pending && run.launchId === id && run.view === exited) {
        run.view = { ...exited, message: failureMessage(error), reasonCode: reason(error) };
      }
    }
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
        const id = run?.launchId;
        if (run && id) {
          await control.stop(id);
          run.exitState = 'stopped';
          run.view = { ...run.view, state: 'stopped', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
          await releaseLease(run, id);
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
        const id = run.launchId;
        if (id) {
          const status = run.exitState ? null : await control.status(id);
          if (status?.running) {
            run.view = { ...run.view, state: 'running' };
            try { await control.focus(id); }
            catch (error) { run.view = { ...run.view, reasonCode: reason(error), message: failureMessage(error) }; }
            return project(run);
          }
          run.exitState ??= status?.exitCode === null || status?.exitCode === 0 ? 'stopped' : 'crashed';
          run.view = { ...run.view, state: run.exitState, accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED' };
          await control.stop(id);
          await releaseLease(run, id);
        }
        run.exitState = undefined;
        run.view = { launchSelector: [...selector], state: 'launching', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
        const launched = await control.launch(selector);
        run.launchId = launched.launchId;
        run.view = { ...run.view, state: 'running' };
      } catch (error) {
        run.view = { ...run.view, state: run.exitState ?? 'crashed', reasonCode: reason(error), message: failureMessage(error), accessAvailable: false };
        return project(run);
      } finally { run.pending = false; }
      return refresh(run);
    }
    if (!run?.launchId) throw new Error('installed-app-run-unavailable');
    if (run.pending) return project(run);
    const id = run.launchId;
    if (command === 'installed_app_focus') {
      await control.focus(id);
      return refresh(run);
    }
    run.pending = true;
    try {
      run.view = { ...run.view, state: 'stopping' };
      await control.stop(id);
      run.exitState = 'stopped';
      run.view = { ...run.view, state: 'stopped', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
      await releaseLease(run, id);
    } catch (error) {
      const running = run.exitState ? false : (await control.status(id)).running;
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
        const id = run.launchId;
        if (!id) continue;
        await control.stop(id);
        run.exitState = 'stopped';
        run.view = { ...run.view, state: 'stopped', accessAvailable: false, accessReasonCode: 'LOCAL_APP_SESSION_REVOKED', message: '' };
        await releaseLease(run, id);
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
