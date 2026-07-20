import type { NimiError } from '../../types/index.js';

export const NIMI_TESTING_HOST_FAILURE_DISPOSITIONS = [
  'unsupported',
  'capability-denied',
  'resource-exhausted',
  'invalid-input',
  'host-unavailable',
  'effect-forbidden',
  'internal',
  'aborted',
] as const;

export type NimiTestingHostFailureDisposition =
  (typeof NIMI_TESTING_HOST_FAILURE_DISPOSITIONS)[number];

export interface NimiTestingHostFailure {
  readonly disposition: NimiTestingHostFailureDisposition;
}

export type NimiTestingHostResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: NimiTestingHostFailure };

export interface NimiTestingUnaryMethod<TRequest, TResult> {
  readonly kind: 'unary';
  readonly request: TRequest;
  readonly result: TResult;
}

export interface NimiTestingStreamMethod<TRequest, TItem> {
  readonly kind: 'stream';
  readonly request: TRequest;
  readonly item: TItem;
}

export type NimiTestingUnaryMethodId<TMethods extends object> = {
  [TKey in keyof TMethods]: TMethods[TKey] extends { readonly kind: 'unary' }
    ? TKey
    : never;
}[keyof TMethods] & string;

export type NimiTestingStreamMethodId<TMethods extends object> = {
  [TKey in keyof TMethods]: TMethods[TKey] extends { readonly kind: 'stream' }
    ? TKey
    : never;
}[keyof TMethods] & string;

export type NimiTestingMethodRequest<TMethod> =
  TMethod extends NimiTestingUnaryMethod<infer TRequest, infer _TResult>
    ? TRequest
    : TMethod extends NimiTestingStreamMethod<infer TRequest, infer _TItem>
      ? TRequest
      : never;

export type NimiTestingMethodResult<TMethod> =
  TMethod extends NimiTestingUnaryMethod<infer _TRequest, infer TResult>
    ? TResult
    : never;

export type NimiTestingMethodItem<TMethod> =
  TMethod extends NimiTestingStreamMethod<infer _TRequest, infer TItem>
    ? TItem
    : never;

export type NimiTestingMethodDeclaration<TMethods extends object> = {
  [TKey in keyof TMethods & string]: {
    readonly id: TKey;
    readonly kind: TMethods[TKey] extends { readonly kind: infer TKind }
      ? Extract<TKind, 'unary' | 'stream'>
      : never;
  };
}[keyof TMethods & string];

export interface NimiTestingCallControl {
  readonly signal?: AbortSignal;
}

export type NimiTestingStreamCancelReason = 'caller' | 'abort';

export type NimiTestingHostStreamTerminal =
  | { readonly state: 'completed' }
  | { readonly state: 'cancelled'; readonly reason: NimiTestingStreamCancelReason };

export interface NimiTestingHostStream<TItem> {
  attach(observer: (item: TItem) => void): NimiTestingHostResult<{ readonly attached: boolean }>;
  readonly completion: Promise<NimiTestingHostResult<NimiTestingHostStreamTerminal>>;
  cancel(
    reason: NimiTestingStreamCancelReason,
  ): Promise<NimiTestingHostResult<{ readonly cancelled: boolean }>>;
}

export interface NimiTestingHostPort<TMethods extends object> {
  invoke<TKey extends NimiTestingUnaryMethodId<TMethods>>(
    methodId: TKey,
    request: NimiTestingMethodRequest<TMethods[TKey]>,
    control: NimiTestingCallControl,
  ): Promise<NimiTestingHostResult<NimiTestingMethodResult<TMethods[TKey]>>>;
  openStream<TKey extends NimiTestingStreamMethodId<TMethods>>(
    methodId: TKey,
    request: NimiTestingMethodRequest<TMethods[TKey]>,
    control: NimiTestingCallControl,
  ): Promise<NimiTestingHostResult<NimiTestingHostStream<NimiTestingMethodItem<TMethods[TKey]>>>>;
}

export interface NimiTestingHarness<TMethods extends object> {
  readonly declaredMethods: ReadonlySet<keyof TMethods & string>;
  invoke<TKey extends NimiTestingUnaryMethodId<TMethods>>(
    methodId: TKey,
    request: NimiTestingMethodRequest<TMethods[TKey]>,
    control?: NimiTestingCallControl,
  ): Promise<NimiTestingHostResult<NimiTestingMethodResult<TMethods[TKey]>>>;
  openStream<TKey extends NimiTestingStreamMethodId<TMethods>>(
    methodId: TKey,
    request: NimiTestingMethodRequest<TMethods[TKey]>,
    control?: NimiTestingCallControl,
  ): Promise<NimiTestingHostResult<NimiTestingHostStream<NimiTestingMethodItem<TMethods[TKey]>>>>;
  projectFailure(methodId: keyof TMethods & string, failure: NimiTestingHostFailure): NimiError;
}

export interface CreateNimiTestingHarnessInput<TMethods extends object> {
  readonly opaqueTraceSeed: string;
  readonly methods: readonly NimiTestingMethodDeclaration<TMethods>[];
  readonly port: NimiTestingHostPort<TMethods>;
}
