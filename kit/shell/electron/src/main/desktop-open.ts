import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  NimiDesktopOpenIntentParseError,
  composeNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenResult,
  type NimiDesktopOpenRejectedActionHint,
  type NimiDesktopOpenResult,
  type NimiDesktopOpenResultReasonCode,
  type NimiDesktopOpenSourceHost,
} from '@nimiplatform/kit/core/desktop-open';
import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { normalizeText } from './paths.js';
import type {
  NimiElectronDesktopOpenFetch,
  NimiElectronDesktopOpenFetchResponse,
  NimiElectronStandardShellHost,
} from './types.js';

const DESKTOP_OPEN_DESCRIPTOR_RELATIVE_PATH = ['.nimi', 'run', 'desktop', 'open-intent', 'presence.v1.json'] as const;
const DESKTOP_OPEN_PATH = '/v1/open-intent';
const DEFAULT_MAX_HEARTBEAT_AGE_MS = 10_000;

export type DesktopOpenPresenceDescriptor = {
  readonly bridgeId: string;
  readonly endpoint: string;
  readonly token: string;
  readonly lastHeartbeatAt: string;
};

export type OpenElectronDesktopIntentInput = {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly appId: string;
};

export async function openElectronDesktopIntent(
  input: OpenElectronDesktopIntentInput,
): Promise<NimiDesktopOpenResult> {
  let envelope;
  try {
    envelope = composeNimiDesktopOpenIntentEnvelope({
      sourceApp: input.appId,
      sourceHost: resolveElectronDesktopOpenSourceHost(input.host),
      request: input.payload,
      createRequestId: input.host?.desktopOpen?.createRequestId,
    });
  } catch (error) {
    return rejectedFromParser(error);
  }

  const descriptorResult = await resolveDesktopOpenPresenceDescriptor(input.host);
  if (!descriptorResult.ok) {
    return desktopOpenRejected(descriptorResult.reasonCode, descriptorResult.actionHint);
  }
  const descriptor = descriptorResult.descriptor;
  const fetchImpl = resolveDesktopOpenFetch(input.host);
  if (!fetchImpl) {
    return desktopOpenRejected('desktop-open-host-unavailable', 'check_desktop_runtime_bridge');
  }

  let response: NimiElectronDesktopOpenFetchResponse;
  try {
    response = await fetchImpl(`${descriptor.endpoint}${DESKTOP_OPEN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${descriptor.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(envelope),
    });
  } catch {
    return desktopOpenRejected('desktop-open-desktop-not-running', 'open_desktop_first');
  }

  if (response.status === 401 || response.status === 403) {
    return desktopOpenRejected('desktop-open-bridge-auth-failed', 'check_desktop_runtime_bridge');
  }

  const rawResult = await readDesktopOpenJsonResponse(response);
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return desktopOpenRejected('desktop-open-desktop-not-running', 'open_desktop_first');
  }
  const record = rawResult as Record<string, unknown>;
  if (normalizeText(record.bridgeId) !== descriptor.bridgeId) {
    return desktopOpenRejected('desktop-open-desktop-not-running', 'open_desktop_first');
  }
  const appResult = record.status === 'rejected'
    ? stripBridgeId(record)
    : record;
  try {
    const parsedResult = parseNimiDesktopOpenResult(appResult);
    if (
      parsedResult.status === 'accepted'
      && (
        parsedResult.requestId !== envelope.requestId
        || parsedResult.appliedTarget !== envelope.intent.kind
      )
    ) {
      return desktopOpenRejected('desktop-open-intent-invalid', 'fix_desktop_open_intent');
    }
    return parsedResult;
  } catch (error) {
    return rejectedFromParser(error);
  }
}

function resolveElectronDesktopOpenSourceHost(
  host: NimiElectronStandardShellHost | undefined,
): NimiDesktopOpenSourceHost {
  if (host?.capabilitySetRef === NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID) {
    return 'desktop-electron-local-app-host';
  }
  if (host?.desktopOpen?.sourceHost) {
    return host.desktopOpen.sourceHost;
  }
  return 'electron-standard-shell';
}

export async function resolveDesktopOpenPresenceDescriptor(
  host: NimiElectronStandardShellHost | undefined,
): Promise<
  | { readonly ok: true; readonly descriptor: DesktopOpenPresenceDescriptor }
  | { readonly ok: false; readonly reasonCode: NimiDesktopOpenResultReasonCode; readonly actionHint: NimiDesktopOpenRejectedActionHint }
> {
  const descriptorPath = host?.desktopOpen?.descriptorPath
    ? path.resolve(host.desktopOpen.descriptorPath)
    : path.join(homedir(), ...DESKTOP_OPEN_DESCRIPTOR_RELATIVE_PATH);
  try {
    await assertNoDescriptorSymlink(descriptorPath);
    const text = host?.desktopOpen?.readTextFile
      ? await host.desktopOpen.readTextFile(descriptorPath)
      : await readFile(descriptorPath, 'utf8');
    const descriptor = parseDesktopOpenPresenceDescriptor(text, host);
    return { ok: true, descriptor };
  } catch {
    return {
      ok: false,
      reasonCode: 'desktop-open-desktop-not-running',
      actionHint: 'open_desktop_first',
    };
  }
}

async function assertNoDescriptorSymlink(descriptorPath: string): Promise<void> {
  const normalizedPath = path.resolve(descriptorPath);
  for (const ancestorPath of descriptorPathAncestors(normalizedPath)) {
    const stat = await lstat(ancestorPath);
    if (stat.isSymbolicLink()) {
      throw new Error('Desktop Open presence descriptor ancestry must not contain symlinks.');
    }
    if (ancestorPath === normalizedPath && !stat.isFile()) {
      throw new Error('Desktop Open presence descriptor must be a regular file.');
    }
  }
}

function descriptorPathAncestors(descriptorPath: string): string[] {
  const parsed = path.parse(descriptorPath);
  const ancestors: string[] = [];
  let current = parsed.root;
  if (current) {
    ancestors.push(current);
  }
  const relative = path.relative(parsed.root, descriptorPath);
  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }
    current = current ? path.join(current, segment) : segment;
    ancestors.push(current);
  }
  return ancestors;
}

function parseDesktopOpenPresenceDescriptor(
  text: string,
  host: NimiElectronStandardShellHost | undefined,
): DesktopOpenPresenceDescriptor {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Desktop Open presence descriptor must be an object.');
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error('Desktop Open presence descriptor schemaVersion must be 1.');
  }
  const descriptor = {
    bridgeId: requireDescriptorText(record.bridgeId, 'bridgeId'),
    endpoint: normalizeDesktopOpenEndpoint(record.endpoint),
    token: requireDescriptorText(record.token, 'token'),
    lastHeartbeatAt: requireDescriptorText(record.lastHeartbeatAt, 'lastHeartbeatAt'),
  };
  const heartbeatMs = Date.parse(descriptor.lastHeartbeatAt);
  const now = host?.desktopOpen?.now?.() ?? Date.now();
  const maxAge = host?.desktopOpen?.maxHeartbeatAgeMs ?? DEFAULT_MAX_HEARTBEAT_AGE_MS;
  if (!Number.isFinite(heartbeatMs) || now - heartbeatMs > maxAge) {
    throw new Error('Desktop Open presence descriptor heartbeat is stale.');
  }
  return descriptor;
}

function normalizeDesktopOpenEndpoint(value: unknown): string {
  const endpoint = requireDescriptorText(value, 'endpoint');
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'http:') {
    throw new Error('Desktop Open bridge endpoint must use http loopback.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1') {
    throw new Error('Desktop Open bridge endpoint must be exact loopback.');
  }
  if (!parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Desktop Open bridge endpoint must be origin-only loopback.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('Desktop Open bridge endpoint must not carry a path.');
  }
  return parsed.origin;
}

function requireDescriptorText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Desktop Open presence descriptor requires ${field}.`);
  }
  return normalized;
}

export function resolveDesktopOpenFetch(host: NimiElectronStandardShellHost | undefined): NimiElectronDesktopOpenFetch | undefined {
  if (host?.desktopOpen?.fetch) {
    return host.desktopOpen.fetch;
  }
  return typeof globalThis.fetch === 'function'
    ? ((url, init) => globalThis.fetch(url, init) as Promise<NimiElectronDesktopOpenFetchResponse>)
    : undefined;
}

export async function readDesktopOpenJsonResponse(response: NimiElectronDesktopOpenFetchResponse): Promise<unknown> {
  if (typeof response.json === 'function') {
    return await response.json();
  }
  if (typeof response.text === 'function') {
    return JSON.parse(await response.text());
  }
  return undefined;
}

function stripBridgeId(record: Record<string, unknown>): Record<string, unknown> {
  const { bridgeId: _bridgeId, ...result } = record;
  return result;
}

function rejectedFromParser(error: unknown): NimiDesktopOpenResult {
  const reasonCode = error instanceof NimiDesktopOpenIntentParseError
    ? parserReasonCode(error)
    : null;
  return desktopOpenRejected(
    reasonCode === 'desktop-open-target-unsupported'
      ? 'desktop-open-target-unsupported'
      : 'desktop-open-intent-invalid',
    'fix_desktop_open_intent',
  );
}

function parserReasonCode(error: NimiDesktopOpenIntentParseError): string {
  return error.reasonCode;
}

function desktopOpenRejected(
  reasonCode: NimiDesktopOpenResultReasonCode,
  actionHint: NimiDesktopOpenRejectedActionHint,
): NimiDesktopOpenResult {
  return { status: 'rejected', reasonCode, actionHint };
}
