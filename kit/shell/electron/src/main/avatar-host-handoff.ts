import {
  buildAvatarHostHandoffRequest,
  parseAvatarHostHandoffResult,
  type AvatarHostHandoffRequest,
  type AvatarHostHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';
import {
  readDesktopOpenJsonResponse,
  resolveDesktopOpenFetch,
  resolveDesktopOpenPresenceDescriptor,
} from './desktop-open.js';
import {
  NimiElectronShellHostError,
  type NimiElectronStandardShellHost,
} from './types.js';

const AVATAR_HOST_HANDOFF_PATH = '/v1/avatar-handoff';

export async function handoffElectronAvatarHost(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly appId: string;
}): Promise<AvatarHostHandoffResult> {
  const request = parseRequest(input.payload, input.command);
  const descriptorResult = await resolveDesktopOpenPresenceDescriptor(input.host);
  if (!descriptorResult.ok) {
    throw handoffError(
      'capability-unavailable',
      'Desktop Avatar Host is not running.',
      'avatar-host-desktop-not-running',
      'open_desktop_first',
    );
  }
  const descriptor = descriptorResult.descriptor;
  const fetchImpl = resolveDesktopOpenFetch(input.host);
  if (!fetchImpl) {
    throw handoffError(
      'capability-unavailable',
      'Avatar Host transport is unavailable.',
      'avatar-host-transport-unavailable',
      'check_desktop_runtime_bridge',
    );
  }

  let response;
  try {
    response = await fetchImpl(`${descriptor.endpoint}${AVATAR_HOST_HANDOFF_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${descriptor.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        sourceApp: input.appId,
        request,
      }),
    });
  } catch {
    throw handoffError(
      'capability-unavailable',
      'Desktop Avatar Host is not reachable.',
      'avatar-host-desktop-not-running',
      'open_desktop_first',
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw handoffError(
      'forbidden-renderer-access',
      'Desktop Avatar Host rejected the transport witness.',
      'avatar-host-bridge-auth-failed',
      'restart_desktop_supervised_app',
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw handoffError(
      'host-internal-error',
      'Desktop Avatar Host did not complete the mechanic.',
      'avatar-host-mechanic-failed',
      'retry_avatar_host_handoff',
    );
  }
  const value = await readDesktopOpenJsonResponse(response);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResult();
  }
  const record = value as Record<string, unknown>;
  if (record.bridgeId !== descriptor.bridgeId) {
    throw handoffError(
      'capability-unavailable',
      'Desktop Avatar Host process witness changed.',
      'avatar-host-desktop-not-running',
      'open_desktop_first',
    );
  }
  const { bridgeId: _bridgeId, ...mechanic } = record;
  try {
    return parseAvatarHostHandoffResult(mechanic, request.command);
  } catch {
    throw invalidResult();
  }
}

function parseRequest(payload: Readonly<Record<string, unknown>>, command: string): AvatarHostHandoffRequest {
  try {
    return buildAvatarHostHandoffRequest(payload as never);
  } catch (error) {
    throw handoffError(
      'invalid-payload',
      error instanceof Error ? error.message : `${command} received invalid payload.`,
      'avatar-host-handoff-payload-invalid',
      'provide_exact_avatar_host_handoff',
    );
  }
}

function invalidResult(): NimiElectronShellHostError {
  return handoffError(
    'host-internal-error',
    'Desktop Avatar Host returned an invalid mechanic result.',
    'avatar-host-handoff-result-invalid',
    'restart_desktop_avatar_host',
  );
}

function handoffError(
  code: 'capability-unavailable' | 'forbidden-renderer-access' | 'invalid-payload' | 'host-internal-error',
  message: string,
  reasonCode: string,
  actionHint: string,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({ code, message, reasonCode, actionHint });
}
