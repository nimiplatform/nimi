import {
  createRuntime,
  type CoreTransport,
} from '@nimiplatform/sdk/runtime';
import type { CoreUnaryRequest } from '@nimiplatform/sdk/types';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import {
  acquireNimiManagedConnectorCredentialInHost,
  type NimiConnectorAuthAcquisitionHttpRequest,
  type NimiConnectorAuthAcquisitionHttpResponse,
  type NimiConnectorAuthAcquisitionTokenExchangeInput,
  type NimiConnectorAuthAcquisitionTokenExchangeResult,
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
  '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector',
  '/nimi.runtime.v1.RuntimeConnectorService/UpdateConnector',
]);
const REQUEST_ID_PATTERN = /^connector-auth-[a-zA-Z0-9_-]{12,160}$/u;
const INPUT_KEYS = new Set(['requestId', 'profileId', 'connectorId', 'provider', 'endpoint', 'label']);
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
  readonly oauthTokenExchange: (
    input: NimiConnectorAuthAcquisitionTokenExchangeInput,
    signal?: AbortSignal,
  ) => Promise<NimiConnectorAuthAcquisitionTokenExchangeResult>;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
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
        provider: request.provider,
        endpoint: request.endpoint,
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
            await input.openExternalUrl(validatedDeviceVerificationUrl(url));
            throwIfAborted(signal);
            return { opened: true };
          },
          oauthTokenExchange: input.oauthTokenExchange,
          sleep: input.sleep ?? sleepWithSignal,
          now: input.now ?? Date.now,
        },
        onPending: (state) => {
          throwIfAborted(controller.signal);
          sendEvent(desktopManagedConnectorAuthPendingEvent(request.requestId), {
            userCode: state.userCode,
            verificationUrl: validatedDeviceVerificationUrl(state.verificationUrl),
            expiresInSeconds: state.expiresInSeconds,
            pollIntervalSeconds: state.pollIntervalSeconds,
          });
        },
      });
      try {
        const result = await operation;
        return {
          profileId: result.profileId,
          providerAuthProfile: result.providerAuthProfile,
          connectorId: result.connectorId,
          expiresAt: result.expiresAt,
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
  readonly provider?: string;
  readonly endpoint?: string;
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
    provider: optionalText(request.provider),
    endpoint: optionalText(request.endpoint),
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

async function sleepWithSignal(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new DOMException('Managed connector acquisition was canceled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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

function validatedDeviceVerificationUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw connectorAuthError(
      'desktop-managed-connector-verification-url-invalid',
      'retry_managed_connector_authorization',
      'Managed connector authorization returned an invalid verification URL.',
      'invalid-payload',
    );
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw connectorAuthError(
      'desktop-managed-connector-verification-url-invalid',
      'retry_managed_connector_authorization',
      'Managed connector authorization requires an HTTPS verification URL.',
      'invalid-payload',
    );
  }
  return parsed.toString();
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
