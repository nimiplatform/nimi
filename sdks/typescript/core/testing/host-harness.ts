import { createNimiTestingHostError } from './host-errors.js';
import { createNimiTestingReadonlySet } from './readonly-set.js';
import {
  NIMI_TESTING_HOST_FAILURE_DISPOSITIONS,
  type CreateNimiTestingHarnessInput,
  type NimiTestingCallControl,
  type NimiTestingHarness,
  type NimiTestingHostFailure,
  type NimiTestingHostFailureDisposition,
  type NimiTestingHostResult,
  type NimiTestingHostStream,
  type NimiTestingHostStreamTerminal,
  type NimiTestingMethodItem,
  type NimiTestingMethodRequest,
  type NimiTestingMethodResult,
  type NimiTestingStreamMethodId,
  type NimiTestingUnaryMethodId,
} from './host-types.js';

const FAILURE_DISPOSITIONS = new Set<string>(NIMI_TESTING_HOST_FAILURE_DISPOSITIONS);
const HOST_INTERNAL_FAILURE = Object.freeze({ disposition: 'internal' as const });
const HOST_ABORTED_FAILURE = Object.freeze({ disposition: 'aborted' as const });

export function createNimiTestingHarness<TMethods extends object>(
  input: CreateNimiTestingHarnessInput<TMethods>,
): NimiTestingHarness<TMethods> {
  const candidateSeed = typeof input?.opaqueTraceSeed === 'string'
    ? input.opaqueTraceSeed
    : '';
  const opaqueTraceSeed = requireTraceSeed(candidateSeed);
  if (!isExactRecord(input, ['methods', 'opaqueTraceSeed', 'port'])
    || opaqueTraceSeed !== candidateSeed
    || !Array.isArray(input.methods)) {
    throw createNimiTestingHostError({
      opaqueTraceSeed,
      errorSequence: 0,
      methodId: 'host-bootstrap',
      disposition: 'internal',
    });
  }
  const methodKinds = new Map<string, 'unary' | 'stream'>();
  for (const method of input.methods) {
    const methodId = typeof method?.id === 'string' ? method.id : '';
    const methodKind = method?.kind;
    if (!isExactRecord(method, ['id', 'kind'])
      || !validMethodId(methodId)
      || (methodKind !== 'unary' && methodKind !== 'stream')) {
      throw createNimiTestingHostError({
        opaqueTraceSeed,
        errorSequence: 0,
        methodId: validMethodId(methodId) ? methodId : 'invalid-method',
        disposition: 'internal',
      });
    }
    if (methodKinds.has(methodId)) {
      throw createNimiTestingHostError({
        opaqueTraceSeed,
        errorSequence: 0,
        methodId,
        disposition: 'internal',
      });
    }
    methodKinds.set(methodId, methodKind);
  }
  if (methodKinds.size === 0 || !validHostPort(input.port)) {
    throw createNimiTestingHostError({
      opaqueTraceSeed,
      errorSequence: 0,
      methodId: 'host-bootstrap',
      disposition: 'internal',
    });
  }

  let errorSequence = 0;
  const declaredMethods = createNimiTestingReadonlySet(
    methodKinds.keys() as Iterable<keyof TMethods & string>,
  );

  function projectFailure(methodId: keyof TMethods & string, failure: NimiTestingHostFailure) {
    errorSequence += 1;
    return createNimiTestingHostError({
      opaqueTraceSeed,
      errorSequence,
      methodId,
      disposition: knownDisposition(failure.disposition) ? failure.disposition : 'internal',
    });
  }

  async function invoke<TKey extends NimiTestingUnaryMethodId<TMethods>>(
    methodId: TKey,
    request: NimiTestingMethodRequest<TMethods[TKey]>,
    control: NimiTestingCallControl = {},
  ): Promise<NimiTestingHostResult<NimiTestingMethodResult<TMethods[TKey]>>> {
    if (methodKinds.get(methodId) !== 'unary') return fail(HOST_INTERNAL_FAILURE);
    if (!validControl(control)) return fail(Object.freeze({ disposition: 'invalid-input' }));
    if (control.signal?.aborted) return fail(HOST_ABORTED_FAILURE);
    try {
      return normalizeHostResult(await input.port.invoke(methodId, request, exactControl(control)));
    } catch {
      return fail(HOST_INTERNAL_FAILURE);
    }
  }

  async function openStream<TKey extends NimiTestingStreamMethodId<TMethods>>(
    methodId: TKey,
    request: NimiTestingMethodRequest<TMethods[TKey]>,
    control: NimiTestingCallControl = {},
  ): Promise<NimiTestingHostResult<NimiTestingHostStream<NimiTestingMethodItem<TMethods[TKey]>>>> {
    if (methodKinds.get(methodId) !== 'stream') return fail(HOST_INTERNAL_FAILURE);
    if (!validControl(control)) return fail(Object.freeze({ disposition: 'invalid-input' }));
    if (control.signal?.aborted) return fail(HOST_ABORTED_FAILURE);
    try {
      const result = normalizeHostResult(
        await input.port.openStream(methodId, request, exactControl(control)),
      );
      if (!result.ok) return result;
      if (!validHostStream(result.value)) return fail(HOST_INTERNAL_FAILURE);
      return ok(normalizeHostStream(result.value, control.signal));
    } catch {
      return fail(HOST_INTERNAL_FAILURE);
    }
  }

  return Object.freeze({ declaredMethods, invoke, openStream, projectFailure });
}

function normalizeHostStream<TItem>(
  source: NimiTestingHostStream<TItem>,
  signal: AbortSignal | undefined,
): NimiTestingHostStream<TItem> {
  let attached = false;
  let cancelStarted = false;
  let terminal = false;
  let removeAbortListener = () => undefined;
  let resolveCompletion: (
    result: NimiTestingHostResult<NimiTestingHostStreamTerminal>,
  ) => void = () => undefined;
  const completion = new Promise<NimiTestingHostResult<NimiTestingHostStreamTerminal>>((resolve) => {
    resolveCompletion = resolve;
  });

  function settle(result: NimiTestingHostResult<NimiTestingHostStreamTerminal>): void {
    if (terminal) return;
    terminal = true;
    removeAbortListener();
    resolveCompletion(result);
  }

  async function cancel(
    reason: 'caller' | 'abort',
  ): Promise<NimiTestingHostResult<{ readonly cancelled: boolean }>> {
    if (reason !== 'caller' && reason !== 'abort') {
      return fail(Object.freeze({ disposition: 'invalid-input' }));
    }
    if (terminal || cancelStarted) return ok(Object.freeze({ cancelled: false }));
    cancelStarted = true;
    removeAbortListener();
    try {
      const result = normalizeBooleanResult(await source.cancel(reason), 'cancelled');
      if (!result.ok) settle(fail(result.error));
      return result;
    } catch {
      const failure = fail<{ readonly cancelled: boolean }>(HOST_INTERNAL_FAILURE);
      settle(fail(HOST_INTERNAL_FAILURE));
      return failure;
    }
  }

  void Promise.resolve(source.completion).then(
    (result) => settle(normalizeTerminalResult(result)),
    () => settle(fail(HOST_INTERNAL_FAILURE)),
  );

  const stream: NimiTestingHostStream<TItem> = Object.freeze({
    attach(
      observer: (item: TItem) => void,
    ): NimiTestingHostResult<{ readonly attached: boolean }> {
      if (typeof observer !== 'function') {
        return fail<{ readonly attached: boolean }>(Object.freeze({ disposition: 'invalid-input' }));
      }
      if (attached || terminal || cancelStarted) {
        return fail<{ readonly attached: boolean }>(HOST_INTERNAL_FAILURE);
      }
      attached = true;
      try {
        const result = normalizeBooleanResult(source.attach((item) => {
          if (terminal) return;
          try {
            observer(item);
          } catch {
            settle(fail(HOST_INTERNAL_FAILURE));
            void safelyCancelSource(source, 'caller');
          }
        }), 'attached');
        if (!result.ok || !result.value.attached) {
          settle(fail(result.ok ? HOST_INTERNAL_FAILURE : result.error));
          void safelyCancelSource(source, 'caller');
          return result.ok
            ? fail<{ readonly attached: boolean }>(HOST_INTERNAL_FAILURE)
            : result;
        }
        return result;
      } catch {
        settle(fail(HOST_INTERNAL_FAILURE));
        void safelyCancelSource(source, 'caller');
        return fail<{ readonly attached: boolean }>(HOST_INTERNAL_FAILURE);
      }
    },
    completion,
    cancel,
  });

  if (signal) {
    const onAbort = () => {
      void cancel('abort');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => {
      signal.removeEventListener('abort', onAbort);
      removeAbortListener = () => undefined;
    };
    if (signal.aborted) onAbort();
  }

  return stream;
}

function normalizeTerminalResult(
  result: NimiTestingHostResult<NimiTestingHostStreamTerminal>,
): NimiTestingHostResult<NimiTestingHostStreamTerminal> {
  const normalized = normalizeHostResult(result);
  if (!normalized.ok) return normalized;
  const terminal = normalized.value;
  if (isExactRecord(terminal, ['state']) && terminal.state === 'completed') {
    return ok(Object.freeze({ state: 'completed' as const }));
  }
  if (isExactRecord(terminal, ['reason', 'state'])
    && terminal.state === 'cancelled'
    && (terminal.reason === 'caller' || terminal.reason === 'abort')) {
    return ok(Object.freeze({ state: 'cancelled' as const, reason: terminal.reason }));
  }
  return fail(HOST_INTERNAL_FAILURE);
}

function normalizeHostResult<TValue>(value: NimiTestingHostResult<TValue>): NimiTestingHostResult<TValue> {
  if (!value || typeof value !== 'object') return fail(HOST_INTERNAL_FAILURE);
  if (isExactRecord(value, ['ok', 'value']) && value.ok === true) return ok(value.value as TValue);
  if (isExactRecord(value, ['error', 'ok'])
    && value.ok === false
    && isExactRecord(value.error, ['disposition'])
    && knownDisposition(value.error.disposition)) {
    return fail(Object.freeze({ disposition: value.error.disposition }));
  }
  return fail(HOST_INTERNAL_FAILURE);
}

function exactControl(control: NimiTestingCallControl): NimiTestingCallControl {
  return control.signal === undefined
    ? Object.freeze({})
    : Object.freeze({ signal: control.signal });
}

function validControl(control: unknown): control is NimiTestingCallControl {
  if (isExactRecord(control, [])) return true;
  return isExactRecord(control, ['signal'])
    && (control.signal === undefined || isAbortSignal(control.signal));
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AbortSignal>;
  return typeof candidate.aborted === 'boolean'
    && typeof candidate.addEventListener === 'function'
    && typeof candidate.removeEventListener === 'function';
}

function validHostPort(value: unknown): boolean {
  if (!isExactRecord(value, ['invoke', 'openStream'])) return false;
  const candidate = value as { readonly invoke?: object; readonly openStream?: object };
  return typeof candidate.invoke === 'function' && typeof candidate.openStream === 'function';
}

function validHostStream(value: unknown): boolean {
  if (!isExactRecord(value, ['attach', 'cancel', 'completion'])) return false;
  const candidate = value as {
    readonly attach?: object;
    readonly completion?: { readonly then?: object };
    readonly cancel?: object;
  };
  return typeof candidate.attach === 'function'
    && typeof candidate.completion?.then === 'function'
    && typeof candidate.cancel === 'function';
}

function knownDisposition(value: unknown): value is NimiTestingHostFailureDisposition {
  return typeof value === 'string' && FAILURE_DISPOSITIONS.has(value);
}

function validMethodId(value: string): boolean {
  return /^nimi\.[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u.test(value)
    && value.length <= 256;
}

function requireTraceSeed(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    return '0'.repeat(64);
  }
  return value;
}

function ok<TValue>(value: TValue): NimiTestingHostResult<TValue> {
  return Object.freeze({ ok: true as const, value });
}

function fail<TValue>(error: NimiTestingHostFailure): NimiTestingHostResult<TValue> {
  return Object.freeze({ ok: false as const, error });
}

function normalizeBooleanResult<TKey extends 'attached' | 'cancelled'>(
  value: NimiTestingHostResult<Readonly<Record<TKey, boolean>>>,
  key: TKey,
): NimiTestingHostResult<Readonly<Record<TKey, boolean>>> {
  const result = normalizeHostResult(value);
  if (!result.ok) return result;
  return isExactRecord(result.value, [key]) && typeof result.value[key] === 'boolean'
    ? ok(Object.freeze({ [key]: result.value[key] }) as Readonly<Record<TKey, boolean>>)
    : fail(HOST_INTERNAL_FAILURE);
}

async function safelyCancelSource<TItem>(
  source: NimiTestingHostStream<TItem>,
  reason: 'caller' | 'abort',
): Promise<void> {
  try {
    await source.cancel(reason);
  } catch {
    // The wrapper is already terminal with an internal host failure.
  }
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
