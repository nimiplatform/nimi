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
import { NimiElectronLocalAppHostError } from './local-app-host.js';

const AVATAR_HOST_HANDOFF_PATH = '/v1/avatar-handoff';

// @nimi-authority: rule.nimi.avatar.embodiment.r023
// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-044
export async function handoffElectronAvatarHost(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly appId: string;
}): Promise<AvatarHostHandoffResult> {
  const parsedRequest = parseRequest(input.payload, input.command);
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
  const request = await runtimeValidatedRequest(input.host, parsedRequest);

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

async function runtimeValidatedRequest(
  host: NimiElectronStandardShellHost | undefined,
  request: AvatarHostHandoffRequest,
): Promise<AvatarHostHandoffRequest> {
  if (request.command !== 'launch') return request;
  const localAppHost = host?.localAppHost;
  if (!localAppHost) {
    throw handoffError(
      'capability-unavailable',
      'Avatar Host handoff requires the caller formal App session.',
      'avatar-host-caller-session-unavailable',
      'restart_desktop_supervised_app',
    );
  }
  const target = request.target;
  let conversationAnchorId = target.conversationAnchorId;
  try {
    if (conversationAnchorId) {
      const snapshot = await localAppHost.conversationSnapshot({
        agentHandle: target.agentHandle,
        conversationAnchorId,
      });
      if (normalizedAnchor(snapshot.conversationAnchorId) !== conversationAnchorId) {
        throw handoffError(
          'invalid-payload',
          'Avatar Host handoff Agent and Conversation do not match.',
          'avatar-host-agent-anchor-mismatch',
          'refresh_current_agent_selection',
        );
      }
    } else {
      const opened = await localAppHost.conversationOpen({ agentHandle: target.agentHandle });
      conversationAnchorId = normalizedAnchor(opened.conversationAnchorId);
      if (!conversationAnchorId) {
        throw handoffError(
          'host-internal-error',
          'Runtime did not return the canonical Conversation continuity fence.',
          'avatar-host-conversation-anchor-unavailable',
          'retry_avatar_host_handoff',
        );
      }
    }
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    if (error instanceof NimiElectronLocalAppHostError) {
      const unavailable = error.retryable || [
        'runtime-service-unavailable',
        'runtime-service-untrusted',
        'runtime-unauthenticated',
        'runtime-restarted',
        'local-app-snapshot-unavailable',
      ].includes(error.reasonCode);
      throw handoffError(
        unavailable ? 'capability-unavailable' : 'invalid-payload',
        unavailable
          ? 'Runtime could not revalidate the Avatar target.'
          : 'Avatar Host handoff target is no longer authorized.',
        unavailable
          ? 'avatar-host-target-revalidation-unavailable'
          : 'avatar-host-target-revalidation-failed',
        unavailable ? 'retry_avatar_host_handoff' : 'refresh_current_agent_selection',
      );
    }
    throw handoffError(
      'host-internal-error',
      'Avatar Host handoff target revalidation failed.',
      'avatar-host-target-revalidation-failed',
      'retry_avatar_host_handoff',
    );
  }
  return buildAvatarHostHandoffRequest({
    command: request.command,
    target: {
      ...target,
      conversationAnchorId,
    },
  });
}

function normalizedAnchor(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
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
