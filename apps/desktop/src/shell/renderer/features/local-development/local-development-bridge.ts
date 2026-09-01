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

export async function startLocalDevelopmentRegistration(
  selector: string,
): Promise<LocalDevelopmentRun> {
  const response = await invokeChecked(
    'local_development_registration_start',
    { payload: { selector: requireSelector(selector) } },
    (value) => value,
  );
  return parseRun(response);
}

export async function stopLocalDevelopmentRun(selector: string): Promise<void> {
  const response = await invokeChecked(
    'local_development_run_stop',
    { payload: { selector: requireSelector(selector) } },
    (value) => value,
  );
  const record = exactRecord(response, ['selector', 'stopped']);
  if (record.stopped !== true || record.selector !== selector) {
    throw new Error('Local development stop response is invalid');
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

export type LocalDevelopmentProjectReadme = {
  readonly content: string | null;
  readonly fileName: string | null;
};

export async function readLocalDevelopmentProjectReadme(
  selector: string,
): Promise<LocalDevelopmentProjectReadme> {
  const response = await invokeChecked(
    'local_development_project_readme',
    { payload: { selector: requireSelector(selector) } },
    (value) => value,
  );
  const record = exactRecord(response, ['content', 'fileName', 'selector']);
  if (record.selector !== selector) throw new Error('Local development readme response is invalid');
  return {
    content: requireReadmeText(record.content),
    fileName: record.fileName === null ? null : requireText(record.fileName),
  };
}

function requireReadmeText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 131_072) {
    throw new Error('Local development readme response is invalid');
  }
  return value;
}

function parseRegistration(value: unknown): LocalDevelopmentRegistration {
  const record = exactRecord(value, [
    'appAccess',
    'aiConfigAllowedRoutes',
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
    aiConfigAllowedRoutes: requireAIConfigAllowedRoutes(record.aiConfigAllowedRoutes),
    sourceGeneration: requireInteger(record.sourceGeneration, 1),
    declarationGeneration: requireInteger(record.declarationGeneration, 1),
    registeredAtUnixMs: requireInteger(record.registeredAtUnixMs, 1),
    updatedAtUnixMs: requireInteger(record.updatedAtUnixMs, 1),
  };
}

function requireAIConfigAllowedRoutes(value: unknown): readonly ('local' | 'cloud')[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw new Error('Local development registration response is invalid');
  }
  const routes = value.map((route) => {
    if (route !== 'local' && route !== 'cloud') {
      throw new Error('Local development registration response is invalid');
    }
    return route;
  });
  if (new Set(routes).size !== routes.length) {
    throw new Error('Local development registration response is invalid');
  }
  return routes;
}

function parseRun(value: unknown): LocalDevelopmentRun {
  const record = requiredRecord(value);
  const expectedKeys = [
    'selector',
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
    selector: requireSelector(record.selector),
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
