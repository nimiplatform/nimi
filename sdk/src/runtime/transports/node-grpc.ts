import { asNimiError, createNimiError } from '../errors.js';
import { ReasonCode } from '../../types/index.js';
import type {
  RuntimeNodeGrpcTransportConfig,
  RuntimeWireMessage,
  RuntimeOpenStreamCall,
  RuntimeStreamCloseCall,
  RuntimeTransport,
  RuntimeUnaryCall,
} from '../types.js';
import type { RuntimeNodeGrpcTransportConfigInternal } from '../types-internal.js';

export type NodeGrpcBridge = {
  invokeUnary(config: RuntimeNodeGrpcTransportConfig, input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage>;
  openStream(config: RuntimeNodeGrpcTransportConfig, input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>>;
  closeStream(config: RuntimeNodeGrpcTransportConfig, input: RuntimeStreamCloseCall): Promise<void>;
};

type NodeGrpcImplementationModule = typeof import('./node-grpc-impl.js');

let nodeGrpcBridge: NodeGrpcBridge | null = null;
let nodeGrpcImplementationPromise: Promise<NodeGrpcImplementationModule> | null = null;

export function setNodeGrpcBridge(bridge: NodeGrpcBridge | null): void {
  nodeGrpcBridge = bridge;
}

function normalizeEndpoint(endpoint: string): string {
  const normalized = String(endpoint || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('http://')) {
    return normalized.slice('http://'.length);
  }
  if (normalized.startsWith('https://')) {
    return normalized.slice('https://'.length);
  }
  return normalized;
}

async function loadNodeGrpcImplementation(): Promise<NodeGrpcImplementationModule> {
  if (nodeGrpcImplementationPromise) {
    return nodeGrpcImplementationPromise;
  }
  nodeGrpcImplementationPromise = import('./node-grpc-impl.js');
  return nodeGrpcImplementationPromise;
}

async function resolveImplementationTransport(
  config: RuntimeNodeGrpcTransportConfigInternal,
  transportPromise: Promise<RuntimeTransport> | null,
  setTransportPromise: (next: Promise<RuntimeTransport> | null) => void,
): Promise<RuntimeTransport> {
  if (transportPromise) {
    return transportPromise;
  }
  const next = loadNodeGrpcImplementation()
    .then((module) => module.createNodeGrpcTransportInternal(config));
  setTransportPromise(next);
  try {
    return await next;
  } catch (error) {
    setTransportPromise(null);
    throw error;
  }
}

export function createNodeGrpcTransport(
  config: RuntimeNodeGrpcTransportConfig,
): RuntimeTransport {
  const internalConfig = config as RuntimeNodeGrpcTransportConfigInternal;
  if (!normalizeEndpoint(internalConfig.endpoint)) {
    throw createNimiError({
      message: 'node-grpc transport requires endpoint',
      reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED,
      actionHint: 'set_runtime_endpoint',
      source: 'sdk',
    });
  }
  let implementationTransportPromise: Promise<RuntimeTransport> | null = null;

  return {
    invokeUnary: async (input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage> => {
      try {
        if (nodeGrpcBridge) {
          return await nodeGrpcBridge.invokeUnary(internalConfig, input);
        }
        const transport = await resolveImplementationTransport(
          internalConfig,
          implementationTransportPromise,
          (next) => {
            implementationTransportPromise = next;
          },
        );
        return await transport.invokeUnary(input);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
          actionHint: 'check_runtime_endpoint_and_network',
          source: 'runtime',
        });
      }
    },
    openStream: async (input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>> => {
      try {
        if (nodeGrpcBridge) {
          return await nodeGrpcBridge.openStream(internalConfig, input);
        }
        const transport = await resolveImplementationTransport(
          internalConfig,
          implementationTransportPromise,
          (next) => {
            implementationTransportPromise = next;
          },
        );
        return await transport.openStream(input);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
          actionHint: 'check_runtime_endpoint_and_network',
          source: 'runtime',
        });
      }
    },
    closeStream: async (input: RuntimeStreamCloseCall): Promise<void> => {
      try {
        if (nodeGrpcBridge) {
          await nodeGrpcBridge.closeStream(internalConfig, input);
          return;
        }
        const pendingTransport = implementationTransportPromise;
        if (!pendingTransport) {
          return;
        }
        const transport = await pendingTransport;
        await transport.closeStream(input);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_CLOSE_FAILED,
          actionHint: 'retry_close_or_drop_stream',
          source: 'runtime',
        });
      }
    },
    destroy: async (): Promise<void> => {
      try {
        const pendingTransport = implementationTransportPromise;
        implementationTransportPromise = null;
        if (!pendingTransport) {
          return;
        }
        const transport = await pendingTransport;
        await transport.destroy();
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_CLOSE_FAILED,
          actionHint: 'retry_close_or_recreate_runtime_client',
          source: 'runtime',
        });
      }
    },
  };
}
