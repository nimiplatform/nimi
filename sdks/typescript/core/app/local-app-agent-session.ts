import { CoreClient, type CoreTransport } from '../../core-client';
import { RuntimeTypedClient } from '../../core-generated/runtime-typed-client';
import { getRuntimeWireCodec } from '../../core-generated/runtime-wire-codecs';
import {
  RUNTIME_AGENT_SESSION_METHODS,
  type RuntimeAgentSessionModule,
} from '../../runtime/runtime-method-modules';
import {
  createNimiError,
  ReasonCode,
  type CoreStreamRequest,
  type CoreUnaryRequest,
} from '../../types';

export type NimiLocalAppAgentSessionStreamNext =
  | { readonly completed: true }
  | { readonly completed: false; readonly chunk: Uint8Array };

export interface NimiLocalAppAgentSessionShell {
  agentSessionUnary(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<Uint8Array>;
  agentSessionStreamOpen(input: {
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }): Promise<{ readonly streamId: string }>;
  agentSessionStreamNext(input: {
    readonly streamId: string;
  }): Promise<NimiLocalAppAgentSessionStreamNext>;
  agentSessionStreamClose(input: {
    readonly streamId: string;
  }): Promise<{ readonly closed: boolean }>;
}

export type NimiLocalAppAgentSessionClient = RuntimeAgentSessionModule;

// A native read may resolve after its handle has been closed. Remove the
// listener on every settled read, including long-lived, high-volume streams.
function readUntilAbort<T>(read: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
  if (!signal) return read;
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    read.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

const ADMITTED_AGENT_SESSION_PREFIX = '/nimi.runtime.v1.AgentSessionService/';

function assertAgentSessionMethod(methodId: unknown): asserts methodId is string {
  if (typeof methodId !== 'string' || !methodId.startsWith(ADMITTED_AGENT_SESSION_PREFIX)) {
    throw createNimiError({
      message: `Unsupported AgentSessionService method: ${String(methodId)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      actionHint: 'use_agent_session_service_method',
      source: 'sdk',
    });
  }
}

// @nimi-authority: rule.nimi.platform.core-protocol.agent-session-operations
export function createNimiLocalAppAgentSessionClient(
  shell: NimiLocalAppAgentSessionShell,
): NimiLocalAppAgentSessionClient {
  const transport: CoreTransport = {
    async unary<Response = unknown, Body = unknown>(
      request: CoreUnaryRequest<Body>,
    ): Promise<Response> {
      assertAgentSessionMethod(request.methodId);
      if (request.signal?.aborted) {
        throw createNimiError({
          message: 'AgentSessionService request aborted.',
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_if_needed',
          source: 'sdk',
        });
      }
      const codec = getRuntimeWireCodec(request.methodId);
      const requestBytes = codec.encodeRequest(request.body);
      const responseBytes = await shell.agentSessionUnary({
        methodId: request.methodId,
        requestBytes,
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      });
      if (request.signal?.aborted) {
        throw createNimiError({
          message: 'AgentSessionService request aborted.',
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_if_needed',
          source: 'sdk',
        });
      }
      return codec.decodeResponse(responseBytes) as Response;
    },
    serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      assertAgentSessionMethod(request.methodId);
      const codec = getRuntimeWireCodec(request.methodId);
      const requestBytes = codec.encodeRequest(request.body);
      const signal = request.signal;
      return {
        async *[Symbol.asyncIterator]() {
          if (signal?.aborted) {
            return;
          }
          const opening = shell.agentSessionStreamOpen({
            methodId: request.methodId,
            requestBytes,
            ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
          });
          let cancelOpening!: () => void;
          const aborted = new Promise<undefined>(resolve => { cancelOpening = () => resolve(undefined); });
          let closed: Promise<void> | undefined;
          let completedNormally = false;
          const closeOnce = () => {
            if (completedNormally) return Promise.resolve();
            return closed ??= opening.then(({ streamId }) => shell.agentSessionStreamClose({ streamId })).then(() => undefined, () => undefined);
          };
          const onAbort = () => { cancelOpening(); void closeOnce(); };
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
          try {
            const opened = await Promise.race([opening, aborted]);
            if (!opened || signal?.aborted) return;
            const { streamId } = opened;
            while (!signal?.aborted) {
              const next = await readUntilAbort(shell.agentSessionStreamNext({ streamId }), signal);
              if (!next) return;
              if (next.completed) {
                completedNormally = true;
                return;
              }
              if (signal?.aborted) {
                return;
              }
              yield codec.decodeResponse(next.chunk) as Response;
            }
          } finally {
            signal?.removeEventListener('abort', onAbort);
            if (signal?.aborted) void closeOnce();
            else await closeOnce();
          }
        },
      };
    },
  };

  const client = new RuntimeTypedClient(new CoreClient({ transport }));
  const bound: Record<string, unknown> = {};
  for (const key of RUNTIME_AGENT_SESSION_METHODS) {
    const fn = client[key];
    if (typeof fn !== 'function') {
      throw createNimiError({
        message: `Generated RuntimeTypedClient is missing AgentSessionService method: ${key}`,
        reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
        actionHint: 'regenerate_sdks',
        source: 'sdk',
      });
    }
    bound[key] = fn.bind(client);
  }
  return Object.freeze(bound) as NimiLocalAppAgentSessionClient;
}
