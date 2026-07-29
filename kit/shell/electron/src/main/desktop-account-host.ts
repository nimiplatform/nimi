import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { asRecord } from './paths.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import { NimiElectronShellHostError } from './types.js';

const DESKTOP_ACCOUNT_COMMANDS = [
  'runtime_account_session_status',
  'runtime_account_session_events_open',
  'runtime_account_session_events_close',
  'runtime_account_permission_owner_unary',
  'runtime_account_begin_login',
  'runtime_account_complete_login',
  'runtime_account_invoke_realm_unary',
  'runtime_account_logout',
  'runtime_account_switch_account',
] as const;
const MAX_ACCOUNT_EVENT_STREAMS = 4;

type DesktopAccountCommand = typeof DESKTOP_ACCOUNT_COMMANDS[number];
type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'error'; readonly reasonCode: unknown; readonly retryable: unknown };

export type NimiElectronDesktopAccountBinding = {
  readonly desktopAccountSessionStatus: () => Promise<NativeJsonOutcome>;
  readonly desktopAccountSessionEventsOpen: (input: { readonly afterSequence: string }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountSessionEventsNext: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountSessionEventsClose: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
  readonly desktopPermissionOwnerUnary: (input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountBeginLogin: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountCompleteLogin: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountInvokeRealmUnary: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountLogout: (input: unknown) => Promise<NativeJsonOutcome>;
  readonly desktopAccountSwitchAccount: (input: unknown) => Promise<NativeJsonOutcome>;
};

const BINDING_METHOD_BY_COMMAND = {
  runtime_account_session_status: 'desktopAccountSessionStatus',
  runtime_account_begin_login: 'desktopAccountBeginLogin',
  runtime_account_complete_login: 'desktopAccountCompleteLogin',
  runtime_account_invoke_realm_unary: 'desktopAccountInvokeRealmUnary',
  runtime_account_logout: 'desktopAccountLogout',
  runtime_account_switch_account: 'desktopAccountSwitchAccount',
} as const;

type DesktopAccountStreamContext = {
  readonly eventChannelPrefix: string;
  readonly sender?: { readonly send?: (channel: string, payload: unknown) => void };
};

type AccountStreamState = {
  cancelled: boolean;
  readonly eventChannel: string;
  readonly streamId: string;
};

export type NimiElectronDesktopAccountHost = {
  readonly invoke: (
    command: DesktopAccountCommand,
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ) => Promise<unknown>;
  readonly close: () => void;
};

class ElectronDesktopAccountHost implements NimiElectronDesktopAccountHost {
  private readonly streams = new Map<string, AccountStreamState>();
  private pendingStreamOpens = 0;
  private closeGeneration = 0;

  constructor(private readonly binding: NimiElectronDesktopAccountBinding) {}

  async invoke(
    command: DesktopAccountCommand,
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ): Promise<unknown> {
    if (command === 'runtime_account_session_events_open') {
      return this.openEvents(payload, context);
    }
    if (command === 'runtime_account_session_events_close') {
      return this.closeEvents(payload);
    }
    if (command === 'runtime_account_permission_owner_unary') {
      return this.permissionOwnerUnary(payload);
    }
    assertExactKeys(
      payload,
      command === 'runtime_account_session_status' ? [] : ['payload'],
      command,
    );
    const method = this.binding[BINDING_METHOD_BY_COMMAND[command]] as (input?: unknown) => Promise<NativeJsonOutcome>;
    const input = command === 'runtime_account_session_status'
      ? undefined
      : asRecord(payload.payload, `${command} payload must be an object`);
    let outcome: NativeJsonOutcome;
    try {
      outcome = input === undefined ? await method() : await method(input);
    } catch {
      throw desktopAccountError('runtime-service-untrusted', false, command);
    }
    if (outcome?.status === 'error') {
      if (typeof outcome.reasonCode !== 'string'
        || !isBoundedReasonCode(outcome.reasonCode)
        || typeof outcome.retryable !== 'boolean') {
        throw desktopAccountError('runtime-service-untrusted', false, command);
      }
      throw desktopAccountError(outcome.reasonCode, outcome.retryable, command);
    }
    if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) {
      throw desktopAccountError('runtime-service-untrusted', false, command);
    }
    return outcome.value;
  }

  private async permissionOwnerUnary(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    assertExactKeys(payload, ['methodId', 'requestBytesBase64', 'timeoutMs'], 'runtime_account_permission_owner_unary');
    const methodId = String(payload.methodId || '').trim();
    if (!PERMISSION_OWNER_METHODS.has(methodId)) {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_permission_owner_unary');
    }
    const requestBytesBase64 = String(payload.requestBytesBase64 || '');
    if (!isCanonicalBase64(requestBytesBase64)) {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_permission_owner_unary');
    }
    const timeoutMs = payload.timeoutMs;
    if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_permission_owner_unary');
    }
    let outcome: NativeJsonOutcome;
    try {
      outcome = await this.binding.desktopPermissionOwnerUnary({
        methodId,
        requestBytes: Uint8Array.from(Buffer.from(requestBytesBase64, 'base64')),
        timeoutMs,
      });
    } catch {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_permission_owner_unary');
    }
    if (outcome.status === 'error') throw nativeOutcomeError(outcome, 'runtime_account_permission_owner_unary');
    const bytes = outcome.value;
    if (!(bytes instanceof Uint8Array)) {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_permission_owner_unary');
    }
    return { responseBytesBase64: Buffer.from(bytes).toString('base64') };
  }

  close(): void {
    this.closeGeneration += 1;
    for (const stream of this.streams.values()) {
      stream.cancelled = true;
      void this.binding.desktopAccountSessionEventsClose({ streamId: stream.streamId })
        .catch(() => undefined);
    }
    this.streams.clear();
  }

  private async openEvents(
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ): Promise<unknown> {
    assertExactKeys(payload, ['afterSequence'], 'runtime_account_session_events_open');
    const afterSequence = canonicalSequence(payload.afterSequence, 'afterSequence');
    if (!context?.sender?.send || !context.eventChannelPrefix) {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
    }
    if (this.streams.size + this.pendingStreamOpens >= MAX_ACCOUNT_EVENT_STREAMS) {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
    }
    this.pendingStreamOpens += 1;
    const openGeneration = this.closeGeneration;
    let outcome: NativeJsonOutcome;
    try {
      outcome = await this.binding.desktopAccountSessionEventsOpen({ afterSequence });
    } catch {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
    } finally {
      this.pendingStreamOpens -= 1;
    }
    const value = unwrapOutcome(outcome, 'runtime_account_session_events_open');
    assertExactKeys(value, ['streamId'], 'runtime_account_session_events_open result');
    const streamId = boundedStreamId(value.streamId);
    if (openGeneration !== this.closeGeneration) {
      void this.binding.desktopAccountSessionEventsClose({ streamId }).catch(() => undefined);
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
    }
    if (this.streams.has(streamId)) {
      void this.binding.desktopAccountSessionEventsClose({ streamId }).catch(() => undefined);
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
    }
    const stream: AccountStreamState = {
      cancelled: false,
      eventChannel: `${context.eventChannelPrefix}runtime_account_session_events`,
      streamId,
    };
    this.streams.set(streamId, stream);
    void this.pumpEvents(stream, context);
    return { streamId };
  }

  private async pumpEvents(stream: AccountStreamState, context: DesktopAccountStreamContext): Promise<void> {
    try {
      while (!stream.cancelled && this.streams.get(stream.streamId) === stream) {
        const outcome = await this.binding.desktopAccountSessionEventsNext({ streamId: stream.streamId });
        if (outcome.status === 'error') {
          sendAccountEvent(context, stream.eventChannel, {
            streamId: stream.streamId,
            eventType: 'error',
            error: nativeOutcomeError(outcome, 'runtime_account_session_events_open').envelope,
          });
          break;
        }
        const value = unwrapOutcome(outcome, 'runtime_account_session_events_open');
        assertExactKeys(
          value,
          value.completed === true ? ['completed'] : ['completed', 'event'],
          'runtime_account_session_events_open result',
        );
        const completed = value.completed;
        if (typeof completed !== 'boolean') {
          throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
        }
        if (completed) {
          sendAccountEvent(context, stream.eventChannel, { streamId: stream.streamId, eventType: 'completed' });
          break;
        }
        if (!isPlainRecord(value.event)) {
          throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
        }
        if (!sendAccountEvent(context, stream.eventChannel, {
          streamId: stream.streamId,
          eventType: 'next',
          event: value.event,
        })) break;
      }
    } catch (error) {
      if (!stream.cancelled) {
        sendAccountEvent(context, stream.eventChannel, {
          streamId: stream.streamId,
          eventType: 'error',
          error: error instanceof NimiElectronShellHostError
            ? error.envelope
            : desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open').envelope,
        });
      }
    } finally {
      if (this.streams.get(stream.streamId) === stream) {
        this.streams.delete(stream.streamId);
      }
      await this.binding.desktopAccountSessionEventsClose({ streamId: stream.streamId }).catch(() => undefined);
    }
  }

  private async closeEvents(payload: Readonly<Record<string, unknown>>): Promise<unknown> {
    assertExactKeys(payload, ['streamId'], 'runtime_account_session_events_close');
    const streamId = boundedStreamId(payload.streamId);
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.cancelled = true;
      this.streams.delete(streamId);
    }
    let outcome: NativeJsonOutcome;
    try {
      outcome = await this.binding.desktopAccountSessionEventsClose({ streamId });
    } catch {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_close');
    }
    const value = unwrapOutcome(outcome, 'runtime_account_session_events_close');
    assertExactKeys(value, ['closed'], 'runtime_account_session_events_close result');
    if (typeof value.closed !== 'boolean') {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_close');
    }
    return {};
  }
}

class LazyElectronDesktopAccountHost implements NimiElectronDesktopAccountHost {
  private host: NimiElectronDesktopAccountHost | undefined;

  invoke(
    command: DesktopAccountCommand,
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ): Promise<unknown> {
    this.host ??= new ElectronDesktopAccountHost(loadPlatformBinding());
    return this.host.invoke(command, payload, context);
  }

  close(): void {
    this.host?.close();
    this.host = undefined;
  }
}

export function createNimiElectronDesktopAccountHost(): NimiElectronDesktopAccountHost {
  return new LazyElectronDesktopAccountHost();
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronDesktopAccountHostForBinding(
  binding: NimiElectronDesktopAccountBinding,
): NimiElectronDesktopAccountHost {
  return new ElectronDesktopAccountHost(validateBinding(binding));
}

export function isElectronDesktopAccountCommand(command: string): command is DesktopAccountCommand {
  return (DESKTOP_ACCOUNT_COMMANDS as readonly string[]).includes(command);
}

function loadPlatformBinding(): NimiElectronDesktopAccountBinding {
  try {
    const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronShellHostError) throw error;
    throw desktopAccountError('protected-carrier-required', false, 'runtime_account_session_status');
  }
}

function validateBinding(value: unknown): NimiElectronDesktopAccountBinding {
  if (!isPlainRecord(value)) {
    throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_status');
  }
  for (const method of [
    ...Object.values(BINDING_METHOD_BY_COMMAND),
    'desktopAccountSessionEventsOpen',
    'desktopPermissionOwnerUnary',
    'desktopAccountSessionEventsNext',
    'desktopAccountSessionEventsClose',
  ]) {
    if (typeof value[method] !== 'function') {
      throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_status');
    }
  }
  return value as NimiElectronDesktopAccountBinding;
}

function unwrapOutcome(outcome: NativeJsonOutcome, command: string): Record<string, unknown> {
  if (outcome?.status === 'error') {
    throw nativeOutcomeError(outcome, command);
  }
  if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) {
    throw desktopAccountError('runtime-service-untrusted', false, command);
  }
  return outcome.value;
}

function nativeOutcomeError(outcome: NativeJsonOutcome, command: string): NimiElectronShellHostError {
  if (outcome.status !== 'error'
    || typeof outcome.reasonCode !== 'string'
    || !isBoundedReasonCode(outcome.reasonCode)
    || typeof outcome.retryable !== 'boolean') {
    return desktopAccountError('runtime-service-untrusted', false, command);
  }
  return desktopAccountError(outcome.reasonCode, outcome.retryable, command);
}

function assertExactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))
    || allowed.some((key) => !Object.hasOwn(value, key))) {
    throw desktopAccountError('runtime-service-untrusted', false, label);
  }
}

function canonicalSequence(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw desktopAccountError('runtime-service-untrusted', false, field);
  }
  try {
    if (BigInt(value) > 18_446_744_073_709_551_615n) throw new Error('overflow');
  } catch {
    throw desktopAccountError('runtime-service-untrusted', false, field);
  }
  return value;
}

function boundedStreamId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
    || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw desktopAccountError('runtime-service-untrusted', false, 'streamId');
  }
  return value;
}

function desktopAccountError(reasonCode: string, retryable: boolean, command: string): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_protected_desktop_account_operation' : 'refresh_runtime_account_projection',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: { command, retryable },
  });
}

const PERMISSION_OWNER_METHODS = new Set([
  '/nimi.runtime.v1.RuntimeAccountService/ListLocalAppPermissionRequests',
  '/nimi.runtime.v1.RuntimeAccountService/GetLocalAppPermissionOwnerProjection',
  '/nimi.runtime.v1.RuntimeAccountService/ListLocalAppPermissionOwnerProjections',
  '/nimi.runtime.v1.RuntimeAccountService/DecideLocalAppPermission',
  '/nimi.runtime.v1.RuntimeAccountService/RevokeLocalAppPermission',
]);

function isCanonicalBase64(value: string): boolean {
  return value.length <= 4 * 1024 * 1024
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}

function isBoundedReasonCode(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sendAccountEvent(
  context: DesktopAccountStreamContext,
  channel: string,
  payload: unknown,
): boolean {
  try {
    context.sender?.send?.(channel, payload);
    return true;
  } catch {
    return false;
  }
}
