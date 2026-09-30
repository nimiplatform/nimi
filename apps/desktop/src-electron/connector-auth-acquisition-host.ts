import {
  createRuntime,
  type CoreTransport,
} from '@nimiplatform/sdk/runtime';
import type { CoreUnaryRequest } from '@nimiplatform/sdk/types';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  acquireNimiManagedConnectorCredentialInHost,
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  NimiConnectorAuthAcquisitionError,
  type NimiConnectorAuthAcquisitionCallback,
  type NimiConnectorAuthAcquisitionCallbackRequest,
  type NimiConnectorAuthAcquisitionCrypto,
  type NimiConnectorAuthAcquisitionHttpRequest,
  type NimiConnectorAuthAcquisitionHttpResponse,
  type NimiManagedConnectorCredentialRuntime,
} from '@nimiplatform/sdk/runtime/host';
import {
  NimiElectronShellHostError,
  type NimiElectronCommandHandler,
  type NimiElectronDesktopControlHost,
  type NimiElectronIpcMainInvokeEvent,
} from '@nimiplatform/kit/shell/electron/main';
import type { WebContents } from 'electron';
import {
  DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
  DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
  desktopManagedConnectorAuthPendingEvent,
} from '../src/shell/shared/connector-auth-acquisition-contract.js';

const DESKTOP_CONNECTOR_RUNTIME_METHODS = new Set([
  '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors',
  '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector',
  '/nimi.runtime.v1.RuntimeConnectorService/UpdateConnector',
]);
const REQUEST_ID_PATTERN = /^connector-auth-[a-zA-Z0-9_-]{12,160}$/u;
const INPUT_KEYS = new Set(['requestId', 'profileId', 'connectorId', 'label']);
const DESKTOP_ACCOUNT_PRODUCT_REQUEST_TIMEOUT_MS = 300_000;
let desktopCredentialUnaryRequestCounter = 0;

export type DesktopElectronConnectorAuthAcquisitionHost = {
  readonly commandHandlers: Readonly<Record<
    | typeof DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND
    | typeof DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
    NimiElectronCommandHandler
  >>;
  readonly shutdown: () => Promise<void>;
};

export function bindDesktopSenderInvalidation(
  webContents: Pick<WebContents, 'on'>,
  invalidate: () => void,
): void {
  webContents.on('render-process-gone', invalidate);
  webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) invalidate();
  });
}

export function createDesktopManagedConnectorCredentialRuntime(
  controlHost: NimiElectronDesktopControlHost,
): NimiManagedConnectorCredentialRuntime {
  const transport: CoreTransport = {
    async unary<Response = unknown, Body = unknown>(
      request: CoreUnaryRequest<Body>,
    ): Promise<Response> {
      if (!DESKTOP_CONNECTOR_RUNTIME_METHODS.has(request.methodId)) {
        throw connectorAuthError(
          'desktop-managed-connector-runtime-method-forbidden',
          'use_existing_connector_create_or_update',
          'Desktop managed connector acquisition attempted an unadmitted Runtime method.',
        );
      }
      if (request.signal?.aborted) throw request.signal.reason;
      const codec = getRuntimeWireCodec(request.methodId);
      let responseBytes: Uint8Array;
      try {
        responseBytes = await controlHost.accountProductUnary({
          methodId: request.methodId,
          requestBytes: codec.encodeRequest(request.body),
          timeoutMs: request.timeoutMs,
          requestId: desktopCredentialUnaryRequestId(request.metadata?.idempotencyKey),
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal?.aborted && runtimeUnaryWasCanceled(error)) {
          throw request.signal.reason ?? new DOMException('Managed connector custody write was canceled', 'AbortError');
        }
        throw error;
      }
      return codec.decodeResponse(responseBytes) as Response;
    },
    serverStream(): AsyncIterable<never> {
      throw connectorAuthError(
        'desktop-managed-connector-runtime-stream-forbidden',
        'use_existing_connector_create_or_update',
        'Desktop managed connector acquisition does not admit Runtime streams.',
      );
    },
  };
  return createRuntime({
    appId: 'nimi.desktop',
    hostOwnedIdentity: true,
    transport,
  }).connectors;
}

export function createDesktopElectronConnectorAuthAcquisitionHost(input: {
  readonly proxyHttp: (
    request: NimiConnectorAuthAcquisitionHttpRequest,
    signal?: AbortSignal,
  ) => Promise<NimiConnectorAuthAcquisitionHttpResponse>;
  readonly runtime: NimiManagedConnectorCredentialRuntime;
  readonly openExternalUrl: (url: string) => Promise<void> | void;
  readonly startAuthorizationCallback: (
    request: NimiConnectorAuthAcquisitionCallbackRequest,
    signal?: AbortSignal,
  ) => Promise<NimiConnectorAuthAcquisitionCallback>;
  readonly hostIdentifier: () => Promise<string>;
  readonly crypto?: NimiConnectorAuthAcquisitionCrypto;
  readonly now?: () => number;
  readonly authorizeSender: (event: NimiElectronIpcMainInvokeEvent) => boolean;
  readonly subscribeSenderInvalidation?: (listener: () => void) => () => void;
}): DesktopElectronConnectorAuthAcquisitionHost {
  type ActiveAcquisition = {
    readonly controller: AbortController;
    readonly completion: Promise<void>;
    finalWriteDispatched: boolean;
  };
  const active = new Map<string, ActiveAcquisition>();
  let closed = false;
  let unsubscribeSenderInvalidation: (() => void) | undefined;
  const cancelActive = (message: string) => {
    for (const record of active.values()) {
      if (!record.finalWriteDispatched && !record.controller.signal.aborted) {
        record.controller.abort(new DOMException(message, 'AbortError'));
      }
    }
  };
  unsubscribeSenderInvalidation = input.subscribeSenderInvalidation?.(() => {
    cancelActive('Desktop renderer was invalidated during managed connector acquisition');
  });

  const requireAuthorizedSender = (event: NimiElectronIpcMainInvokeEvent) => {
    if (!input.authorizeSender(event)) {
      throw connectorAuthError(
        'desktop-managed-connector-sender-forbidden',
        'use_desktop_main_renderer',
        'Managed connector authorization requires the protected Desktop renderer.',
        'forbidden-renderer-access',
      );
    }
  };

  const commandHandlers: DesktopElectronConnectorAuthAcquisitionHost['commandHandlers'] = {
    [DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND]: async ({ payload, event, sendEvent }) => {
      requireAuthorizedSender(event);
      if (closed) {
        throw connectorAuthError(
          'desktop-managed-connector-host-closed',
          'restart_desktop',
          'Desktop managed connector acquisition host is closed.',
          'capability-unavailable',
        );
      }
      if (!sendEvent) {
        throw connectorAuthError(
          'desktop-managed-connector-event-channel-unavailable',
          'restart_desktop',
          'Desktop managed connector acquisition requires the protected renderer event channel.',
          'capability-unavailable',
        );
      }
      const request = parseAcquisitionRequest(payload);
      if (active.has(request.requestId)) {
        throw connectorAuthError(
          'desktop-managed-connector-request-active',
          'retry_managed_connector_authorization',
          'Desktop managed connector acquisition request is already active.',
          'invalid-payload',
        );
      }
      const controller = new AbortController();
      let completeAcquisition: (() => void) | undefined;
      const record: ActiveAcquisition = {
        controller,
        completion: new Promise<void>((resolve) => {
          completeAcquisition = resolve;
        }),
        finalWriteDispatched: false,
      };
      active.set(request.requestId, record);
      const runtime: NimiManagedConnectorCredentialRuntime = {
        listConnectors(runtimeRequest, callOptions) {
          return input.runtime.listConnectors(runtimeRequest, callOptions);
        },
        createConnector(runtimeRequest, callOptions) {
          record.finalWriteDispatched = true;
          return input.runtime.createConnector(runtimeRequest, callOptions);
        },
        updateConnector(runtimeRequest, callOptions) {
          record.finalWriteDispatched = true;
          return input.runtime.updateConnector(runtimeRequest, callOptions);
        },
      };
      const operation = acquireNimiManagedConnectorCredentialInHost({
        profileId: request.profileId,
        connectorId: request.connectorId,
        label: request.label,
        runtime,
        signal: controller.signal,
        callOptions: {
          timeoutMs: DESKTOP_ACCOUNT_PRODUCT_REQUEST_TIMEOUT_MS,
          metadata: { idempotencyKey: request.requestId },
        },
        host: {
          proxyHttp: input.proxyHttp,
          openExternalUrl: async (url, signal) => {
            throwIfAborted(signal);
            await input.openExternalUrl(validatedAuthorizationUrl(request.profileId, url));
            throwIfAborted(signal);
            return { opened: true };
          },
          startAuthorizationCallback: input.startAuthorizationCallback,
          hostIdentifier: () => input.hostIdentifier(),
          crypto: input.crypto ?? (globalThis.crypto as NimiConnectorAuthAcquisitionCrypto),
          now: input.now ?? Date.now,
        },
        onPending: (state) => {
          throwIfAborted(controller.signal);
          sendEvent(desktopManagedConnectorAuthPendingEvent(request.requestId), {
            authorizationUrl: validatedAuthorizationUrl(request.profileId, state.authorizationUrl),
            expiresInSeconds: state.expiresInSeconds,
          });
        },
      });
      try {
        const result = await operation.catch((error: unknown) => {
          throw desktopAcquisitionError(error);
        });
        return {
          profileId: result.profileId,
          providerAuthProfile: result.providerAuthProfile,
          connectorId: result.connectorId,
          ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
        };
      } finally {
        active.delete(request.requestId);
        completeAcquisition?.();
      }
    },
    [DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND]: ({ payload, event }) => {
      requireAuthorizedSender(event);
      const requestId = parseCancellationRequest(payload);
      const record = active.get(requestId);
      const canceled = Boolean(record && !record.finalWriteDispatched);
      if (canceled && record && !record.controller.signal.aborted) {
        record.controller.abort(new DOMException('Managed connector acquisition was canceled', 'AbortError'));
      }
      return { canceled };
    },
  };

  return {
    commandHandlers,
    async shutdown(): Promise<void> {
      closed = true;
      unsubscribeSenderInvalidation?.();
      unsubscribeSenderInvalidation = undefined;
      cancelActive('Desktop is shutting down during managed connector acquisition');
      await Promise.all(Array.from(active.values(), (record) => record.completion));
    },
  };
}

function desktopCredentialUnaryRequestId(idempotencyKey: string | undefined): string {
  const requestId = String(idempotencyKey || '').trim();
  if (requestId && requestId.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(requestId)) {
    return requestId;
  }
  desktopCredentialUnaryRequestCounter += 1;
  return `desktop-credential-unary-${Date.now()}-${desktopCredentialUnaryRequestCounter}`;
}

function runtimeUnaryWasCanceled(error: unknown): boolean {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const record = error as { readonly reasonCode?: unknown; readonly code?: unknown };
  return record.reasonCode === 'runtime-request-canceled' || record.code === 'runtime-request-canceled';
}

function parseAcquisitionRequest(payload: Readonly<Record<string, unknown>>): {
  readonly requestId: string;
  readonly profileId: string;
  readonly connectorId?: string;
  readonly label?: string;
} {
  const envelope = exactRecord(payload, new Set(['payload']), 'managed connector acquisition envelope');
  const request = exactRecord(envelope.payload, INPUT_KEYS, 'managed connector acquisition request');
  const requestId = requiredText(request.requestId, 'requestId');
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw connectorAuthError(
      'desktop-managed-connector-request-id-invalid',
      'retry_managed_connector_authorization',
      'Desktop managed connector acquisition request ID is invalid.',
      'invalid-payload',
    );
  }
  return {
    requestId,
    profileId: requiredText(request.profileId, 'profileId'),
    connectorId: optionalText(request.connectorId),
    label: optionalText(request.label),
  };
}

function parseCancellationRequest(payload: Readonly<Record<string, unknown>>): string {
  const envelope = exactRecord(payload, new Set(['payload']), 'managed connector cancellation envelope');
  const request = exactRecord(
    envelope.payload,
    new Set(['requestId']),
    'managed connector cancellation request',
  );
  const requestId = requiredText(request.requestId, 'requestId');
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw connectorAuthError(
      'desktop-managed-connector-request-id-invalid',
      'retry_managed_connector_authorization',
      'Desktop managed connector acquisition request ID is invalid.',
      'invalid-payload',
    );
  }
  return requestId;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Managed connector acquisition was canceled', 'AbortError');
  }
}

function exactRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw connectorAuthError(
      'desktop-managed-connector-payload-invalid',
      'retry_managed_connector_authorization',
      `${label} must be an object.`,
      'invalid-payload',
    );
  }
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw connectorAuthError(
        'desktop-managed-connector-payload-invalid',
        'retry_managed_connector_authorization',
        `${label} contains an unexpected field.`,
        'invalid-payload',
      );
    }
  }
  return record;
}

function requiredText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (normalized) return normalized;
  throw connectorAuthError(
    'desktop-managed-connector-payload-invalid',
    'retry_managed_connector_authorization',
    `Desktop managed connector acquisition requires ${field}.`,
    'invalid-payload',
  );
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() !== value) {
    throw connectorAuthError(
      'desktop-managed-connector-payload-invalid',
      'retry_managed_connector_authorization',
      'Desktop managed connector acquisition contains an invalid text field.',
      'invalid-payload',
    );
  }
  return value || undefined;
}

// Only the admitted profile's exact authorization endpoint may open in the
// system browser or reach the renderer as a reopen link.
function validatedAuthorizationUrl(profileId: string, value: string): string {
  const profile = Object.hasOwn(CONNECTOR_AUTH_ACQUISITION_PROFILES, profileId)
    ? CONNECTOR_AUTH_ACQUISITION_PROFILES[profileId]
    : undefined;
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  if (!profile || !parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash ||
    `${parsed.origin}${parsed.pathname}` !== profile.authorizationUrl) {
    throw connectorAuthError(
      'desktop-managed-connector-authorization-url-invalid',
      'retry_managed_connector_authorization',
      'Managed connector authorization produced an unadmitted browser URL.',
      'invalid-payload',
    );
  }
  return parsed.toString();
}

const ACQUISITION_ERRORS: Readonly<Record<string, readonly [string, string, string]>> = {
  AUTHORIZATION_DENIED: ['desktop-chatgpt-plan-authorization-denied', 'retry_chatgpt_plan_sign_in', 'ChatGPT sign-in was canceled or denied.'],
  PLAN_USAGE_NOT_GRANTED: ['desktop-chatgpt-plan-usage-not-granted', 'enable_chatgpt_plan_usage_and_retry', 'ChatGPT plan usage was not granted for this sign-in.'],
  AUTHORIZATION_INVALID: ['desktop-chatgpt-plan-authorization-invalid', 'retry_chatgpt_plan_sign_in', 'ChatGPT sign-in could not be verified.'],
  REGISTRATION_UNAVAILABLE: ['desktop-chatgpt-plan-registration-unavailable', 'add_chatgpt_plan_account_again', 'This connector has no ChatGPT plan registration to reauthorize.'],
  BROWSER_UNAVAILABLE: ['desktop-chatgpt-plan-browser-unavailable', 'open_browser_and_retry', 'The browser could not be opened for ChatGPT sign-in.'],
};

// Maps SDK acquisition outcomes to stable host errors without provider text,
// codes or tokens; Runtime typed errors and cancellation pass through.
function desktopAcquisitionError(error: unknown): unknown {
  if (error instanceof NimiConnectorAuthAcquisitionError) {
    const [reasonCode, actionHint, message] = ACQUISITION_ERRORS[error.code] ?? ACQUISITION_ERRORS.AUTHORIZATION_INVALID!;
    return connectorAuthError(reasonCode, actionHint, message, 'invalid-payload');
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return connectorAuthError(
      'desktop-managed-connector-authorization-timeout',
      'retry_chatgpt_plan_sign_in',
      'ChatGPT sign-in did not finish in time.',
      'capability-unavailable',
    );
  }
  return error;
}

function connectorAuthError(
  reasonCode: string,
  actionHint: string,
  message: string,
  code: 'capability-unavailable' | 'forbidden-renderer-access' | 'host-internal-error' | 'invalid-payload' = 'host-internal-error',
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code,
    reasonCode,
    actionHint,
    message,
  });
}
