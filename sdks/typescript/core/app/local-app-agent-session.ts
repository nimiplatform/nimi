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

const ADMITTED_AGENT_SESSION_PREFIX = '/nimi.runtime.v1.AgentSessionService/';

function assertAgentSessionMethod(methodId: string): void {
  if (!methodId.startsWith(ADMITTED_AGENT_SESSION_PREFIX)) {
    throw createNimiError({
      message: `Unsupported AgentSessionService method: ${methodId}`,
      reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      actionHint: 'use_agent_session_service_method',
      source: 'sdk',
    });
  }
}

// @nimi-authority: rule.nimi.runtime.agent-participation.p-agp-011
export function createNimiLocalAppAgentSessionClient(
  shell: NimiLocalAppAgentSessionShell,
): NimiLocalAppAgentSessionClient {
  const transport: CoreTransport = {
    async unary<Response = unknown, Body = unknown>(
      request: CoreUnaryRequest<Body>,
    ): Promise<Response> {
      assertAgentSessionMethod(request.methodId);
      const codec = getRuntimeWireCodec(request.methodId);
      const requestBytes = codec.encodeRequest(request.body);
      const responseBytes = await shell.agentSessionUnary({
        methodId: request.methodId,
        requestBytes,
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      });
      return codec.decodeResponse(responseBytes) as Response;
    },
    serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      assertAgentSessionMethod(request.methodId);
      const codec = getRuntimeWireCodec(request.methodId);
      const requestBytes = codec.encodeRequest(request.body);
      return {
        async *[Symbol.asyncIterator]() {
          const { streamId } = await shell.agentSessionStreamOpen({
            methodId: request.methodId,
            requestBytes,
            ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
          });
          let closed = false;
          try {
            while (true) {
              const next = await shell.agentSessionStreamNext({ streamId });
              if (next.completed) {
                closed = true;
                return;
              }
              yield codec.decodeResponse(next.chunk) as Response;
            }
          } finally {
            if (!closed) {
              await shell.agentSessionStreamClose({ streamId }).catch(() => undefined);
            }
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
