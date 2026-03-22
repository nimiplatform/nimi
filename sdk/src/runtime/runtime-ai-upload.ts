import { createNimiError } from './errors.js';
import { ReasonCode } from '../types/index.js';
import type { RuntimeInternalContext } from './internal-context.js';
import type { RuntimeAiUploadArtifactInput } from './types-runtime-modules.js';
import type { RuntimeCallOptions, RuntimeMetadata, RuntimeNodeGrpcTransportConfig } from './types.js';
import { encodeRequest, decodeUnaryResponse } from './core/client-codec.js';
import { UploadArtifactRequest, UploadArtifactResponse } from './generated/runtime/v1/ai.js';

type GrpcModule = typeof import('@grpc/grpc-js');

const defaultUploadChunkSize = 256 * 1024;
const uploadArtifactMethodId = '/nimi.runtime.v1.RuntimeAiService/UploadArtifact';
let grpcModulePromise: Promise<GrpcModule> | null = null;

export async function runtimeUploadArtifact(
  ctx: RuntimeInternalContext,
  input: RuntimeAiUploadArtifactInput,
  options?: RuntimeCallOptions,
): Promise<UploadArtifactResponse> {
  const transport = ctx.options.transport;
  if (!transport || transport.type !== 'node-grpc') {
    throw createNimiError({
      message: 'uploadArtifact requires node-grpc transport',
      reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
      actionHint: 'use_node_grpc_transport_for_ai_upload',
      source: 'sdk',
    });
  }

  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
  const normalizedMimeType = String(input.mimeType || '').trim();
  const payload = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes || []);
  if (!normalizedMimeType || payload.length === 0) {
    throw createNimiError({
      message: 'mimeType and bytes are required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'set_mime_type_and_bytes',
      source: 'sdk',
    });
  }

  const grpc = await loadGrpcModule();
  const endpoint = normalizeEndpoint(transport);
  const client = new grpc.Client(
    endpoint,
    toChannelCredentials(grpc, transport),
    toChannelOptions(transport),
  );

  try {
    const callOptions = ctx.resolveRuntimeCallOptions({
      timeoutMs: options?.timeoutMs,
      metadata: options?.metadata as Record<string, string> | undefined,
      idempotencyKey: options?.idempotencyKey,
    });
    const authorization = await resolveAuthorizationHeader(ctx);
    const metadata = toGrpcMetadata(grpc, transport, callOptions.metadata, authorization);

    const responseBytes = await new Promise<Uint8Array>((resolve, reject) => {
      const call = client.makeClientStreamRequest(
        uploadArtifactMethodId,
        (value: Uint8Array) => Buffer.from(value),
        (value: Buffer) => new Uint8Array(value),
        metadata,
        toGrpcCallOptions(callOptions.timeoutMs),
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response || new Uint8Array());
        },
      );

      const chunkSize = resolveChunkSize(input.chunkSize);
      const metadataFrame = encodeRequest(uploadArtifactMethodId, {
        requestType: UploadArtifactRequest,
        eventType: UploadArtifactResponse,
      }, {
        payload: {
          oneofKind: 'metadata',
          metadata: {
            appId: ctx.appId,
            subjectUserId,
            mimeType: normalizedMimeType,
            displayName: String(input.displayName || '').trim(),
          },
        },
      });
      call.write(metadataFrame);

      let sequence = 0n;
      for (let offset = 0; offset < payload.length; offset += chunkSize) {
        const bytes = payload.slice(offset, Math.min(offset + chunkSize, payload.length));
        const frame = encodeRequest(uploadArtifactMethodId, {
          requestType: UploadArtifactRequest,
          eventType: UploadArtifactResponse,
        }, {
          payload: {
            oneofKind: 'chunk',
            chunk: {
              sequence: sequence.toString(),
              bytes,
            },
          },
        });
        call.write(frame);
        sequence += 1n;
      }
      call.end();
    });

      return decodeUnaryResponse(
      uploadArtifactMethodId,
      {
        requestType: UploadArtifactRequest,
        responseType: UploadArtifactResponse,
      },
      responseBytes,
    );
  } finally {
    client.close();
  }
}

function resolveChunkSize(input?: number): number {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    return Math.floor(input);
  }
  return defaultUploadChunkSize;
}

function normalizeEndpoint(config: RuntimeNodeGrpcTransportConfig): string {
  const normalized = String(config.endpoint || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: 'node-grpc endpoint is required',
      reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
      actionHint: 'set_runtime_endpoint',
      source: 'sdk',
    });
  }
  if (normalized.startsWith('http://')) {
    return normalized.slice('http://'.length);
  }
  if (normalized.startsWith('https://')) {
    return normalized.slice('https://'.length);
  }
  return normalized;
}

async function loadGrpcModule(): Promise<GrpcModule> {
  if (!grpcModulePromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    grpcModulePromise = dynamicImport('@grpc/grpc-js') as Promise<GrpcModule>;
  }
  return grpcModulePromise;
}

function toChannelCredentials(grpc: GrpcModule, config: RuntimeNodeGrpcTransportConfig) {
  const tls = config.tls;
  if (!tls?.enabled) {
    return grpc.credentials.createInsecure();
  }
  const rootCert = tls.rootCertPem ? Buffer.from(tls.rootCertPem, 'utf-8') : undefined;
  return grpc.credentials.createSsl(rootCert);
}

function toChannelOptions(config: RuntimeNodeGrpcTransportConfig) {
  const serverName = String(config.tls?.serverName || '').trim();
  if (!serverName) {
    return {};
  }
  return {
    'grpc.ssl_target_name_override': serverName,
    'grpc.default_authority': serverName,
  };
}

function toGrpcMetadata(
  grpc: GrpcModule,
  transport: RuntimeNodeGrpcTransportConfig,
  metadata: RuntimeMetadata | undefined,
  authorization?: string,
) {
  const value = new grpc.Metadata();
  const append = (key: string, entry: unknown) => {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(entry || '').trim();
    if (normalizedKey && normalizedValue) {
      if (/[\r\n\0]/.test(normalizedKey) || /[\r\n\0]/.test(normalizedValue)) {
        throw createNimiError({
          message: `invalid gRPC metadata value for ${normalizedKey}`,
          reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
          actionHint: 'remove_control_characters_from_metadata',
          source: 'sdk',
        });
      }
      value.set(normalizedKey, normalizedValue);
    }
  };
  append('x-nimi-protocol-version', metadata?.protocolVersion);
  append('x-nimi-participant-protocol-version', metadata?.participantProtocolVersion);
  append('x-nimi-participant-id', metadata?.participantId);
  append('x-nimi-domain', metadata?.domain);
  append('x-nimi-app-id', metadata?.appId);
  append('x-nimi-trace-id', metadata?.traceId);
  append('x-nimi-idempotency-key', metadata?.idempotencyKey);
  append('x-nimi-caller-kind', metadata?.callerKind);
  append('x-nimi-caller-id', metadata?.callerId);
  append('x-nimi-surface-id', metadata?.surfaceId);
  append('x-nimi-key-source', metadata?.keySource);
  append('x-nimi-provider-type', metadata?.providerType);
  append('x-nimi-client-id', metadata?.clientId);
  append('x-nimi-provider-endpoint', metadata?.providerEndpoint);
  const providerApiKey = String(metadata?.providerApiKey || '').trim();
  if (providerApiKey && !transportAllowsPlaintextProviderKey(transport)) {
    throw createNimiError({
      message: 'providerApiKey requires TLS or a loopback-only node-grpc endpoint',
      reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
      actionHint: 'enable_tls_or_use_loopback_for_provider_api_key',
      source: 'sdk',
    });
  }
  append('x-nimi-provider-api-key', providerApiKey);
  for (const [key, entry] of Object.entries(metadata?.extra || {})) {
    append(key, entry);
  }
  if (authorization) {
    value.set('authorization', authorization);
  }
  return value;
}

function transportAllowsPlaintextProviderKey(config: RuntimeNodeGrpcTransportConfig): boolean {
  if (config.tls?.enabled) {
    return true;
  }
  const endpoint = normalizeEndpoint(config);
  const host = endpoint.split(':')[0]?.trim().toLowerCase() || '';
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

function toGrpcCallOptions(timeoutMs?: number) {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {};
  }
  return { deadline: Date.now() + timeoutMs };
}

async function resolveAuthorizationHeader(ctx: RuntimeInternalContext): Promise<string | undefined> {
  const accessToken = ctx.options.auth?.accessToken;
  if (typeof accessToken === 'function') {
    return formatAuthorizationHeader(await accessToken());
  }
  return formatAuthorizationHeader(accessToken);
}

function formatAuthorizationHeader(accessToken: string | undefined): string | undefined {
  const normalized = String(accessToken || '').trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.toLowerCase().startsWith('bearer ')) {
    return normalized;
  }
  return `Bearer ${normalized}`;
}
