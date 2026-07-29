import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke';
import type { DeveloperModeProjection } from './developer-mode-types.js';

export type { DeveloperModeProjection } from './developer-mode-types.js';

const subscribers = new Set<(enabled: boolean) => void>();
let current: DeveloperModeProjection = unavailable('protected-carrier-required', false);
let refreshInFlight: Promise<DeveloperModeProjection> | undefined;

/**
 * Returns only the last Runtime-derived projection. The safe initial value is
 * disabled; renderer storage and launch flags never create Developer Mode.
 */
export function isDeveloperModeEnabled(): boolean {
  return current.state === 'enabled' && current.enabled;
}

export function isDeveloperToolsEnabled(): boolean {
  return isDeveloperModeEnabled();
}

export function subscribeDeveloperMode(onChange: (enabled: boolean) => void): () => void {
  subscribers.add(onChange);
  if (!refreshInFlight && hasElectronInvoke()) {
    refreshInFlight = refreshDeveloperMode().finally(() => {
      refreshInFlight = undefined;
    });
    void refreshInFlight.catch(() => undefined);
  }
  return () => subscribers.delete(onChange);
}

export async function refreshDeveloperMode(): Promise<DeveloperModeProjection> {
  if (!hasElectronInvoke()) {
    return publish(unavailable('protected-carrier-required', false));
  }
  return publish(await invokeChecked('developer_mode_status', {}, parseDeveloperModeProjection));
}

export async function setDeveloperMode(enabled: boolean): Promise<DeveloperModeProjection> {
  if (!hasElectronInvoke()) {
    throw new Error('protected-carrier-required');
  }
  return publish(await invokeChecked(
    'developer_mode_set',
    { payload: { enabled } },
    parseDeveloperModeProjection,
  ));
}

function publish(next: DeveloperModeProjection): DeveloperModeProjection {
  const changed = current.enabled !== next.enabled || current.state !== next.state;
  current = next;
  if (changed) {
    for (const subscriber of subscribers) subscriber(isDeveloperModeEnabled());
  }
  return next;
}

export function parseDeveloperModeProjection(value: unknown): DeveloperModeProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('developer-mode-projection-invalid');
  }
  const record = value as Record<string, unknown>;
  const exact = ['accountGeneration', 'enabled', 'reasonCode', 'retryable', 'revision', 'state'];
  if (Object.keys(record).sort().join('|') !== exact.sort().join('|')) {
    throw new Error('developer-mode-projection-invalid');
  }
  if (!['disabled', 'enabled', 'unavailable'].includes(String(record.state))
    || typeof record.enabled !== 'boolean'
    || typeof record.retryable !== 'boolean'
    || typeof record.reasonCode !== 'string') {
    throw new Error('developer-mode-projection-invalid');
  }
  const revision = Number(record.revision);
  const accountGeneration = Number(record.accountGeneration);
  if (!Number.isSafeInteger(revision) || revision < 0
    || !Number.isSafeInteger(accountGeneration) || accountGeneration < 0
    || (record.state === 'enabled') !== record.enabled
    || (record.state !== 'unavailable' && revision === 0)
    || (record.state === 'enabled' && accountGeneration === 0)) {
    throw new Error('developer-mode-projection-invalid');
  }
  return {
    state: record.state as DeveloperModeProjection['state'],
    enabled: record.enabled,
    revision,
    accountGeneration,
    reasonCode: record.reasonCode,
    retryable: record.retryable,
  };
}

function unavailable(reasonCode: string, retryable: boolean): DeveloperModeProjection {
  return {
    state: 'unavailable',
    enabled: false,
    revision: 0,
    accountGeneration: 0,
    reasonCode,
    retryable,
  };
}
