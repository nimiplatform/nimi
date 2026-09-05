import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';

type NativeOutcome = { readonly status: 'ok'; readonly value: unknown } | {
  readonly status: 'error'; readonly reasonCode: string; readonly retryable: boolean;
  readonly reasonMetadata?: Readonly<Record<string, unknown>>;
};
type NativeMethod = (input: Readonly<Record<string, unknown>>) => NativeOutcome | Promise<NativeOutcome>;
type Binding = Readonly<Record<string, NativeMethod>>;
const METHODS = [
  'desktopLaunchInstalledApp', 'desktopInstalledAppStatus', 'desktopFocusInstalledApp',
  'desktopStopInstalledApp', 'desktopEndInstalledAppRun', 'desktopInstalledAppRunAccess',
  'desktopCompleteAppUninstall',
] as const;

export class NimiElectronInstalledAppError extends Error {
  constructor(readonly reasonCode: string, readonly reasonMetadata: Readonly<Record<string, string>> = {}) {
    super(reasonCode);
    this.name = 'NimiElectronInstalledAppError';
  }
}

// Main-only control. Lease identity and native process handles never enter the
// renderer or App bridge, and Runtime still derives all installed authority.
export interface NimiElectronInstalledAppControl {
  launch(selector: Uint8Array): Promise<{ readonly launchId: string; readonly processId: number; readonly appId: string; readonly version: string }>;
  status(launchId: string): Promise<{ readonly running: boolean; readonly exitCode: number | null }>;
  focus(launchId: string): Promise<void>;
  stop(launchId: string): Promise<void>;
  end(launchId: string): Promise<void>;
  access(launchId: string): Promise<{ readonly available: boolean; readonly reasonCode: string }>;
  completeUninstall(jobId: Uint8Array, selector: Uint8Array): Promise<void>;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
export function createNimiElectronInstalledAppControl(): NimiElectronInstalledAppControl {
  let binding: Binding | undefined;
  const resolve = (): Binding => {
    if (binding) return binding;
    const loaded: unknown = loadNimiElectronProtectedLocalPackage(resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch));
    if (!isRecord(loaded) || METHODS.some((method) => typeof loaded[method] !== 'function')) throw new NimiElectronInstalledAppError('local-app-operation-unavailable');
    binding = loaded as Binding;
    return binding;
  };
  return createInstalledControl(resolve);
}

function createInstalledControl(resolve: () => Binding): NimiElectronInstalledAppControl {
  const invoke = async (method: typeof METHODS[number], payload: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> => {
    const call = resolve()[method];
    if (!call) throw new NimiElectronInstalledAppError('local-app-operation-unavailable');
    const result = await call(payload);
    if (result?.status === 'error') {
      if (typeof result.reasonCode !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(result.reasonCode)) invalid();
      const metadata: Record<string, string> = {};
      for (const key of ['native_error_code', 'native_operation', 'runtime_reason_code', 'policy_reason', 'policy_revision']) {
        const value = result.reasonMetadata?.[key];
        if (typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/u.test(value)) metadata[key] = value;
      }
      throw new NimiElectronInstalledAppError(result.reasonCode, metadata);
    }
    if (result?.status !== 'ok' || !isRecord(result.value)) invalid();
    return result.value;
  };
  const action = async (method: typeof METHODS[number], id: string, flag: string): Promise<void> => {
    const result = await invoke(method, { launchId: identifier(id) });
    if (result[flag] !== true || Object.keys(result).length !== 1) invalid();
  };
  return {
    async launch(selector) {
      const bytes = Uint8Array.from(selector);
      if (bytes.length === 0 || bytes.length > 160) invalid();
      const text = Buffer.from(bytes).toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(Buffer.from(bytes))) invalid();
      const result = await invoke('desktopLaunchInstalledApp', { launchSelector: text });
      if (Object.keys(result).sort().join('|') !== 'appId|launchId|processId|version' || !Number.isSafeInteger(result.processId) || Number(result.processId) <= 0) invalid();
      return { launchId: identifier(result.launchId), processId: Number(result.processId), appId: requiredText(result.appId), version: requiredText(result.version) };
    },
    async status(id) {
      const result = await invoke('desktopInstalledAppStatus', { launchId: identifier(id) });
      if (typeof result.running !== 'boolean' || Object.keys(result).sort().join('|') !== 'exitCode|running'
        || (result.exitCode !== null && (!Number.isSafeInteger(result.exitCode) || Number(result.exitCode) < 0 || Number(result.exitCode) > 0xffffffff))
        || (result.running && result.exitCode !== null)) invalid();
      return { running: result.running, exitCode: result.exitCode as number | null };
    },
    focus: (id) => action('desktopFocusInstalledApp', id, 'focused'),
    stop: (id) => action('desktopStopInstalledApp', id, 'stopped'),
    end: (id) => action('desktopEndInstalledAppRun', id, 'ended'),
    async completeUninstall(jobId, selector) {
      const result = await invoke('desktopCompleteAppUninstall', { jobId: opaqueText(jobId), launchSelector: opaqueText(selector) });
      if (result.completed !== true || Object.keys(result).length !== 1) invalid();
    },
    async access(id) {
      const result = await invoke('desktopInstalledAppRunAccess', { launchId: identifier(id) });
      if (typeof result.available !== 'boolean' || Object.keys(result).sort().join('|') !== 'available|reasonCode') invalid();
      return { available: result.available, reasonCode: requiredText(result.reasonCode) };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value) invalid();
  return value;
}
function identifier(value: unknown): string {
  const result = requiredText(value);
  if (!/^[a-f0-9]{64}$/u.test(result) || /^0+$/u.test(result)) invalid();
  return result;
}
function invalid(): never { throw new NimiElectronInstalledAppError('installed-app-launch-failed'); }
function opaqueText(value: Uint8Array): string {
  if (value.length === 0 || value.length > 160) invalid();
  const result = Buffer.from(value).toString('utf8');
  if (!Buffer.from(result).equals(Buffer.from(value))) invalid();
  return result;
}
