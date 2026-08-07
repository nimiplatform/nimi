import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from './local-development-types.js';

export type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from './local-development-types.js';

export function localDevelopmentBridgeAvailable(): boolean {
  return hasElectronInvoke();
}

export async function listLocalDevelopmentRegistrations(): Promise<LocalDevelopmentRegistration[]> {
  const response = await invokeChecked(
    'local_development_registrations_list',
    {},
    (value) => value,
  );
  if (!Array.isArray(response)) throw new Error('Local development registrations response is invalid');
  return response.map(parseRegistration);
}

export async function removeLocalDevelopmentRegistration(selector: string): Promise<void> {
  const response = await invokeChecked(
    'local_development_registration_remove',
    { payload: { selector: requireSelector(selector) } },
    (value) => value,
  );
  const record = exactRecord(response, ['removed', 'selector']);
  if (record.removed !== true || record.selector !== selector) {
    throw new Error('Local development registration removal response is invalid');
  }
}

export async function listLocalDevelopmentRuns(): Promise<LocalDevelopmentRun[]> {
  const response = await invokeChecked(
    'local_development_runs_list',
    {},
    (value) => value,
  );
  if (!Array.isArray(response)) throw new Error('Local development runs response is invalid');
  return response.map(parseRun);
}

function parseRegistration(value: unknown): LocalDevelopmentRegistration {
  const record = exactRecord(value, [
    'appAccess',
    'appId',
    'canonicalProjectRoot',
    'declarationGeneration',
    'displayName',
    'registeredAtUnixMs',
    'selector',
    'shell',
    'sourceGeneration',
    'updatedAtUnixMs',
  ]);
  if (record.shell !== 'electron' || !Array.isArray(record.appAccess)) {
    throw new Error('Local development registration response is invalid');
  }
  return {
    selector: requireSelector(record.selector),
    appId: requireText(record.appId),
    displayName: requireText(record.displayName),
    canonicalProjectRoot: requireText(record.canonicalProjectRoot),
    shell: 'electron',
    appAccess: record.appAccess.map(requireText),
    sourceGeneration: requireInteger(record.sourceGeneration, 1),
    declarationGeneration: requireInteger(record.declarationGeneration, 1),
    registeredAtUnixMs: requireInteger(record.registeredAtUnixMs, 1),
    updatedAtUnixMs: requireInteger(record.updatedAtUnixMs, 1),
  };
}

function parseRun(value: unknown): LocalDevelopmentRun {
  const record = requiredRecord(value);
  const expectedKeys = [
    'appId',
    'canonicalProjectRoot',
    'displayName',
    'hostGeneration',
    'message',
    'retryable',
    ...(Object.hasOwn(record, 'reasonCode') ? ['reasonCode'] : []),
    'shell',
    'state',
  ];
  exactRecord(record, expectedKeys);
  if (record.shell !== 'electron' || typeof record.retryable !== 'boolean') {
    throw new Error('Local development run response is invalid');
  }
  return {
    appId: requireText(record.appId),
    displayName: requireText(record.displayName),
    canonicalProjectRoot: requireText(record.canonicalProjectRoot),
    shell: 'electron',
    state: requireText(record.state),
    message: requireText(record.message),
    ...(record.reasonCode === undefined ? {} : { reasonCode: requireText(record.reasonCode) }),
    retryable: record.retryable,
    hostGeneration: requireInteger(record.hostGeneration, 0),
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = requiredRecord(value);
  if (Object.keys(record).sort().join('|') !== [...keys].sort().join('|')) {
    throw new Error('Local development response is invalid');
  }
  return record;
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local development response is invalid');
  }
  return value as Record<string, unknown>;
}

function requireSelector(value: unknown): string {
  const selected = requireText(value);
  if (!selected.startsWith('dev-project-') || selected.length > 160 || !/^[A-Za-z0-9_-]+$/u.test(selected)) {
    throw new Error('Local development selector is invalid');
  }
  return selected;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.trim() !== value) {
    throw new Error('Local development text is invalid');
  }
  return value;
}

function requireInteger(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error('Local development integer is invalid');
  }
  return Number(value);
}
