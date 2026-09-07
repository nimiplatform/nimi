import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import type { InstalledAppRun } from '../../../shared/installed-app-types.js';

export async function listInstalledAppRuns(): Promise<readonly InstalledAppRun[]> {
  const result = await invokeChecked('installed_app_runs_list', {}, (value) => value);
  if (!Array.isArray(result)) throw new Error('Installed App run projection is invalid');
  return result.map(parseInstalledRun);
}

export async function launchInstalledApp(selector: Uint8Array): Promise<InstalledAppRun> {
  return parseInstalledRun(await invokeChecked('installed_app_launch', { payload: { launchSelector: [...selector] } }, (value) => value));
}

export async function stopInstalledApp(selector: Uint8Array): Promise<void> {
  const result = parseInstalledRun(await invokeChecked('installed_app_stop', { payload: { launchSelector: [...selector] } }, (value) => value));
  if (result.state !== 'stopped') throw new Error('Installed App stop did not complete');
}

export async function finishInstalledAppUninstall(jobId: Uint8Array, selector: Uint8Array): Promise<void> {
  const result = await invokeChecked('installed_app_uninstall', { payload: { jobId: [...jobId], launchSelector: [...selector] } }, (value) => value);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).join('|') !== 'uninstalled' || (result as { uninstalled: unknown }).uninstalled !== true) {
    throw new Error('App uninstall did not complete');
  }
}

function parseInstalledRun(value: unknown): InstalledAppRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Installed App run projection is invalid');
  const row = value as Record<string, unknown>;
  const keys = ['launchSelector', 'state', 'accessAvailable', 'accessReasonCode', 'message', ...(Object.hasOwn(row, 'reasonCode') ? ['reasonCode'] : [])];
  if (Object.keys(row).sort().join('|') !== keys.sort().join('|') || !Array.isArray(row.launchSelector)
    || row.launchSelector.length === 0 || row.launchSelector.length > 160 || row.launchSelector.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    || typeof row.state !== 'string' || !['launching', 'running', 'stopping', 'stopped', 'crashed'].includes(row.state)
    || typeof row.accessAvailable !== 'boolean' || typeof row.accessReasonCode !== 'string' || typeof row.message !== 'string'
    || (row.reasonCode !== undefined && typeof row.reasonCode !== 'string')) throw new Error('Installed App run projection is invalid');
  if (row.accessAvailable && row.state !== 'running') throw new Error('Installed App Access projection has no running Host');
  return { launchSelector: [...row.launchSelector], state: row.state as InstalledAppRun['state'], accessAvailable: row.accessAvailable,
    accessReasonCode: row.accessReasonCode, message: row.message, ...(row.reasonCode ? { reasonCode: row.reasonCode as string } : {}) };
}
