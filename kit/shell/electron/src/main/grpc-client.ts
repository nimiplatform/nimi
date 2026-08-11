import type {
  RuntimeGrpcBridgeClient,
  RuntimeGrpcBridgeStream,
  RuntimeGrpcBridgeStreamRequest,
  RuntimeGrpcBridgeUnaryRequest,
  RuntimeGrpcBridgeUnaryResponse,
} from './types.js';

export async function createDefaultRuntimeGrpcBridgeClient(endpoint: string): Promise<RuntimeGrpcBridgeClient> {
  const grpc = await import('@grpc/grpc-js');
  const client = new grpc.Client(endpoint, grpc.credentials.createInsecure());
  return {
    unary: (request) => invokeRawGrpcUnary(grpc, client, request),
    serverStream: (request) => createRawGrpcServerStream(grpc, client, request),
    close: () => client.close(),
  };
}

function invokeRawGrpcUnary(
  grpc: typeof import('@grpc/grpc-js'),
  client: import('@grpc/grpc-js').Client,
  request: RuntimeGrpcBridgeUnaryRequest,
): Promise<RuntimeGrpcBridgeUnaryResponse> {
  return new Promise((resolve, reject) => {
    let responseMetadata: Record<string, string> = {};
    let callbackReceived = false;
    let statusReceived = false;
    let callbackError: Error | null = null;
    let callbackResponse: Buffer | null | undefined;
    let settled = false;
    let detachAbort: (() => void) | undefined;
    const settleIfComplete = () => {
      if (settled || !callbackReceived || !statusReceived) {
        return;
      }
      settled = true;
      detachAbort?.();
      if (callbackError) {
        reject(callbackError);
        return;
      }
      resolve({
        responseBytes: Uint8Array.from(callbackResponse ?? Buffer.alloc(0)),
        responseMetadata,
      });
    };
    const call = client.makeUnaryRequest(
      request.methodId,
      identityBuffer,
      identityBuffer,
      Buffer.from(request.requestBytes),
      toGrpcMetadata(grpc, request.metadata),
      toGrpcCallOptions(request.timeoutMs),
      (error, response) => {
        callbackReceived = true;
        callbackError = error ?? null;
        callbackResponse = response;
        settleIfComplete();
      },
    );
    call.on('metadata', (metadata) => {
      responseMetadata = {
        ...responseMetadata,
        ...fromGrpcMetadata(metadata),
      };
    });
    call.on('status', (status) => {
      responseMetadata = {
        ...responseMetadata,
        ...fromGrpcMetadata(status.metadata),
      };
      statusReceived = true;
      settleIfComplete();
    });
    if (request.signal) {
      const abort = () => call.cancel();
      if (request.signal.aborted) {
        abort();
      } else {
        request.signal.addEventListener('abort', abort, { once: true });
        detachAbort = () => request.signal?.removeEventListener('abort', abort);
      }
    }
  });
}

function createRawGrpcServerStream(
  grpc: typeof import('@grpc/grpc-js'),
  client: import('@grpc/grpc-js').Client,
  request: RuntimeGrpcBridgeStreamRequest,
): RuntimeGrpcBridgeStream {
  let call: import('@grpc/grpc-js').ClientReadableStream<Buffer> | undefined;
  return {
    start: ({ onData, onError, onEnd }) => {
      call = client.makeServerStreamRequest(
        request.methodId,
        identityBuffer,
        identityBuffer,
        Buffer.from(request.requestBytes),
        toGrpcMetadata(grpc, request.metadata),
        toGrpcCallOptions(request.timeoutMs),
      );
      call.on('data', (bytes) => onData(Uint8Array.from(bytes)));
      call.on('error', onError);
      call.on('end', onEnd);
    },
    cancel: () => {
      call?.cancel();
    },
  };
}

function identityBuffer(value: Buffer): Buffer {
  return value;
}

function toGrpcMetadata(
  grpc: typeof import('@grpc/grpc-js'),
  values: Readonly<Record<string, string>>,
): import('@grpc/grpc-js').Metadata {
  const metadata = new grpc.Metadata();
  for (const [key, value] of Object.entries(values)) {
    metadata.set(key, value);
  }
  return metadata;
}

function fromGrpcMetadata(metadata: import('@grpc/grpc-js').Metadata | undefined): Record<string, string> {
  if (!metadata) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata.getMap())) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (Buffer.isBuffer(value)) {
      out[key] = value.toString('base64');
    }
  }
  return out;
}

function toGrpcCallOptions(timeoutMs: number | undefined): import('@grpc/grpc-js').CallOptions {
  return timeoutMs ? { deadline: new Date(Date.now() + timeoutMs) } : {};
}
