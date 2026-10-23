import { resolveNimiElectronProtectedLocalBindingPackage } from './local-app-host.js';
import { asRecord } from './paths.js';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import { NimiElectronShellHostError } from './types.js';
import {
  parseDesktopAccountSessionEvent,
  parseDesktopAccountSessionStatus,
  type DesktopAccountSessionStatus,
} from '#nimi-shell-account-projection';

const DESKTOP_ACCOUNT_COMMANDS = [
  'runtime_account_session_status',
  'runtime_account_session_events_open',
  'runtime_account_session_events_close',
  'runtime_account_begin_login',
  'runtime_account_complete_login',
  'runtime_account_invoke_realm_unary',
  'runtime_account_logout',
  'runtime_account_switch_account',
] as const;
const MAX_ACCOUNT_EVENT_STREAMS = 4;
const ACCOUNT_PROJECTION_RETRY_MS = 1_000;

type DesktopAccountCommand = typeof DESKTOP_ACCOUNT_COMMANDS[number];
type NativeJsonOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode: unknown;
      readonly retryable: unknown;
      readonly reasonMetadata?: unknown;
    };

export type NimiElectronDesktopAccountBinding = {
  readonly desktopAccountSessionStatus: () => Promise<NativeJsonOutcome>;
  readonly desktopAccountSessionEventsOpen: (input: { readonly afterSequence: string }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountSessionEventsNext: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
  readonly desktopAccountSessionEventsClose: (input: { readonly streamId: string }) => Promise<NativeJsonOutcome>;
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

type AccountProjectionObserver = {
  cancelled: boolean;
  streamId?: string;
  closeRequested?: boolean;
};

export type NimiElectronDesktopAccountSessionProjectionListener = (
  projection: DesktopAccountSessionStatus | null,
) => void;

export type NimiElectronDesktopAccountHost = {
  readonly invoke: (
    command: DesktopAccountCommand,
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ) => Promise<unknown>;
  readonly readSessionStatus: () => Promise<DesktopAccountSessionStatus>;
  /** Null means the observation is unavailable, not an Account state. */
  readonly subscribeSessionProjection: (listener: NimiElectronDesktopAccountSessionProjectionListener) => () => void;
  readonly closeRendererStreams: () => void;
  readonly close: () => void;
};

class ElectronDesktopAccountHost implements NimiElectronDesktopAccountHost {
  private readonly streams = new Map<string, AccountStreamState>();
  private pendingStreamOpens = 0;
  private closeGeneration = 0;
  private readonly projectionListeners = new Set<NimiElectronDesktopAccountSessionProjectionListener>();
  private projectionObserver: AccountProjectionObserver | undefined;
  private projectionRetry: ReturnType<typeof setTimeout> | undefined;
  private currentProjection: DesktopAccountSessionStatus | null = null;
  private closed = false;

  constructor(private readonly binding: NimiElectronDesktopAccountBinding) {}

  async invoke(
    command: DesktopAccountCommand,
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ): Promise<unknown> {
    this.assertOpen(command);
    if (command === 'runtime_account_session_events_open') {
      return this.openEvents(payload, context);
    }
    if (command === 'runtime_account_session_events_close') {
      return this.closeEvents(payload);
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
      throw desktopAccountError(
        outcome.reasonCode,
        outcome.retryable,
        command,
        boundedReasonMetadata(outcome.reasonMetadata),
      );
    }
    if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) {
      throw desktopAccountError('runtime-service-untrusted', false, command);
    }
    return outcome.value;
  }

  // @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
  async readSessionStatus(): Promise<DesktopAccountSessionStatus> {
    const value = await this.invoke('runtime_account_session_status', {});
    this.assertOpen('runtime_account_session_status');
    return parseDesktopAccountSessionStatus(value);
  }

  subscribeSessionProjection(listener: NimiElectronDesktopAccountSessionProjectionListener): () => void {
    this.assertOpen('runtime_account_session_events_open');
    this.projectionListeners.add(listener);
    this.deliverProjection(listener, this.currentProjection);
    this.ensureProjectionObserver();
    return () => {
      this.projectionListeners.delete(listener);
      if (this.projectionListeners.size === 0) this.stopProjectionObserver();
    };
  }

  closeRendererStreams(): void {
    this.closeGeneration += 1;
    for (const stream of this.streams.values()) {
      stream.cancelled = true;
      void this.binding.desktopAccountSessionEventsClose({ streamId: stream.streamId })
        .catch(() => undefined);
    }
    this.streams.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeRendererStreams();
    this.publishProjection(null);
    this.projectionListeners.clear();
    this.stopProjectionObserver();
  }

  private assertOpen(command: DesktopAccountCommand): void {
    if (this.closed) throw desktopAccountError('protected-carrier-required', false, command);
  }

  private deliverProjection(listener: NimiElectronDesktopAccountSessionProjectionListener, projection: DesktopAccountSessionStatus | null): void {
    // Each consumer receives a separate safe value; listener failure cannot own
    // the native observation lifetime or prevent another consumer invalidating.
    try { listener(projection ? parseDesktopAccountSessionStatus(projection) : null); } catch { /* consumer-owned failure */ }
  }

  private publishProjection(projection: DesktopAccountSessionStatus | null): void {
    this.currentProjection = projection;
    for (const listener of this.projectionListeners) this.deliverProjection(listener, projection);
  }

  private ensureProjectionObserver(): void {
    if (this.closed || this.projectionListeners.size === 0 || this.projectionObserver || this.projectionRetry) return;
    const observer: AccountProjectionObserver = { cancelled: false };
    this.projectionObserver = observer;
    void this.observeProjection(observer);
  }

  private stopProjectionObserver(): void {
    if (this.projectionRetry) clearTimeout(this.projectionRetry);
    this.projectionRetry = undefined;
    const observer = this.projectionObserver;
    this.projectionObserver = undefined;
    this.currentProjection = null;
    if (!observer) return;
    observer.cancelled = true;
    void this.closeProjectionStream(observer);
  }

  private async closeProjectionStream(observer: AccountProjectionObserver): Promise<void> {
    if (!observer.streamId || observer.closeRequested) return;
    observer.closeRequested = true;
    await this.binding.desktopAccountSessionEventsClose({ streamId: observer.streamId }).catch(() => undefined);
  }

  private async observeProjection(observer: AccountProjectionObserver): Promise<void> {
    const current = () => !this.closed && !observer.cancelled && this.projectionObserver === observer;
    try {
      if (this.streams.size + this.pendingStreamOpens >= MAX_ACCOUNT_EVENT_STREAMS) {
        throw desktopAccountError('runtime-service-untrusted', false, 'runtime_account_session_events_open');
      }
      this.pendingStreamOpens += 1;
      let outcome: NativeJsonOutcome;
      try {
        // Zero requests the owner's current replacement snapshot. A previous
        // account or Runtime stream cursor never becomes rebind authority.
        outcome = await this.binding.desktopAccountSessionEventsOpen({ afterSequence: '0' });
      } finally {
        this.pendingStreamOpens -= 1;
      }
      const opened = unwrapOutcome(outcome, 'runtime_account_session_events_open');
      assertExactKeys(opened, ['streamId'], 'runtime_account_session_events_open result');
      observer.streamId = boundedStreamId(opened.streamId);
      if (!current()) return;
      while (current()) {
        const next = unwrapOutcome(
          await this.binding.desktopAccountSessionEventsNext({ streamId: observer.streamId }),
          'runtime_account_session_events_open',
        );
        if (!current()) return;
        assertExactKeys(next, next.completed === true ? ['completed'] : ['completed', 'event'], 'runtime_account_session_events_open result');
        if (typeof next.completed !== 'boolean') throw new Error('account observation completion is invalid');
        if (next.completed) break;
        const { deliveryKind: _deliveryKind, replayTruncated: _replayTruncated, ...projection } = parseDesktopAccountSessionEvent(next.event);
        this.publishProjection(projection);
      }
    } catch {
      // Observation failure does not manufacture an Account state. The native
      // caller must make its own fresh status read before a protected action.
    } finally {
      const endedCurrentObserver = this.projectionObserver === observer;
      if (endedCurrentObserver) {
        this.projectionObserver = undefined;
        this.publishProjection(null);
      }
      await this.closeProjectionStream(observer);
      if (endedCurrentObserver) {
        if (!this.closed && this.projectionListeners.size > 0 && !this.projectionObserver) {
          this.projectionRetry = setTimeout(() => {
            this.projectionRetry = undefined;
            this.ensureProjectionObserver();
          }, ACCOUNT_PROJECTION_RETRY_MS);
          this.projectionRetry.unref?.();
        }
      }
    }
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
    if (this.streams.size + this.pendingStreamOpens + (this.projectionObserver?.streamId ? 1 : 0) >= MAX_ACCOUNT_EVENT_STREAMS) {
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
        if (stream.cancelled || this.streams.get(stream.streamId) !== stream) {
          return;
        }
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
  private closed = false;

  private currentHost(): NimiElectronDesktopAccountHost {
    if (this.closed) throw desktopAccountError('protected-carrier-required', false, 'runtime_account_session_status');
    return this.host ??= new ElectronDesktopAccountHost(loadPlatformBinding());
  }

  invoke(
    command: DesktopAccountCommand,
    payload: Readonly<Record<string, unknown>>,
    context?: DesktopAccountStreamContext,
  ): Promise<unknown> {
    return this.currentHost().invoke(command, payload, context);
  }

  async readSessionStatus(): Promise<DesktopAccountSessionStatus> {
    return this.currentHost().readSessionStatus();
  }

  subscribeSessionProjection(listener: NimiElectronDesktopAccountSessionProjectionListener): () => void {
    return this.currentHost().subscribeSessionProjection(listener);
  }

  closeRendererStreams(): void {
    this.host?.closeRendererStreams();
  }

  close(): void {
    this.closed = true;
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
  return desktopAccountError(
    outcome.reasonCode,
    outcome.retryable,
    command,
    boundedReasonMetadata(outcome.reasonMetadata),
  );
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

function desktopAccountError(
  reasonCode: string,
  retryable: boolean,
  command: string,
  reasonMetadata: Readonly<Record<string, string>> = {},
): NimiElectronShellHostError {
  const code = reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : reasonCode === 'runtime-service-error-unclassified'
            ? 'runtime-service-error-unclassified'
            : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: reasonCode,
    reasonCode,
    actionHint: retryable ? 'retry_protected_desktop_account_operation' : 'refresh_runtime_account_projection',
    source: reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: {
      command,
      retryable,
      ...(Object.keys(reasonMetadata).length > 0 ? { reasonMetadata } : {}),
    },
  });
}

function boundedReasonMetadata(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) throw new Error('runtime account reason metadata is invalid');
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!['diagnostic_stage', 'local_development_reason_code', 'grpc_status_code', 'capability'].includes(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw new Error('runtime account reason metadata is invalid');
    }
    metadata[key] = entry;
  }
  return Object.freeze(metadata);
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
