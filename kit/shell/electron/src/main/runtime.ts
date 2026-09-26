import { NIMI_STANDARD_SHELL_CAPABILITY_IDS, NIMI_STANDARD_SHELL_COMMANDS, type NimiStandardShellCapabilityId } from '@nimiplatform/kit/shell/capabilities';
import {
  GetAppAIConfigRequest,
  OverwriteAppAIConfigRequest,
  ListAppAIConfigOptionsRequest,
  InvokeRealmUnaryRequest,
} from '@nimiplatform/sdk/runtime/host';
import {
  isElectronDesktopAccountProductMethod,
  isElectronDesktopMachineProductMethod,
  NimiElectronDesktopControlHostError,
  type NimiElectronDesktopControlHost,
} from './desktop-control-host.js';
import {
  createElectronRuntimeEndpointUnavailableError,
  toElectronRuntimeBridgeError,
} from './errors.js';
import { normalizeRequiredToken, normalizeText } from './paths.js';
import type {
  ElectronRuntimeBridgeCommandNames,
  ElectronRuntimeBridgeStreamOpenResponse,
  ElectronRuntimeBridgeTrustedMetadata,
  ElectronRuntimeBridgeTrustedMetadataProvider,
  ElectronRuntimeBridgeUnaryRequest,
  ElectronRuntimeBridgeUnaryResponse,
  NimiElectronIpcMainInvokeEvent,
  RuntimeGrpcBridgeClient,
  RuntimeGrpcBridgeStream,
  RuntimeGrpcBridgeUnaryResponse,
} from './types.js';
import { NimiElectronShellHostError } from './types.js';
import {
  assertElectronGenericRuntimeMethodAllowed,
  buildElectronRuntimeGrpcMetadata,
  fromBase64,
  parseElectronRuntimeStreamOpenRequest,
  parseElectronRuntimeUnaryCancelRequest,
  parseElectronRuntimeUnaryRequest,
  toBase64,
} from './runtime-bridge-protocol.js';
import {
  resolveTrustedRuntimeMetadata,
  resolveTrustedRuntimeMetadataWithSingleInvalidation,
  trustedRuntimeMetadataInvalidationReason,
} from './runtime-trusted-metadata.js';
export { resolveTrustedRuntimeMetadata } from './runtime-trusted-metadata.js';
export {
  assertNoRendererSensitiveMetadata,
  assertNoRendererSensitiveRuntimeBridgePayload,
  buildElectronRuntimeGrpcMetadata,
  electronRuntimeCommandPayload,
  parseElectronRuntimeStreamOpenRequest,
  parseElectronRuntimeUnaryCancelRequest,
  parseElectronRuntimeUnaryRequest,
} from './runtime-bridge-protocol.js';
function standardCommand(key: keyof typeof NIMI_STANDARD_SHELL_COMMANDS): string {
  return NIMI_STANDARD_SHELL_COMMANDS[key];
}

export function createElectronRuntimeBridgeCommandNames(
  _commandNamespace = '',
): ElectronRuntimeBridgeCommandNames {
  return {
    unary: standardCommand('runtime.unary'),
    stream_open: standardCommand('runtime.streamOpen'),
    stream_close: standardCommand('runtime.streamClose'),
    status: standardCommand('runtime-lifecycle.status'),
    start: standardCommand('runtime-lifecycle.start'),
    restart: standardCommand('runtime-lifecycle.restart'),
  };
}
export const ELECTRON_STANDARD_SHELL_CAPABILITY_IDS = NIMI_STANDARD_SHELL_CAPABILITY_IDS;
export function getElectronStandardShellCapabilityIds(): readonly NimiStandardShellCapabilityId[] {
  return ELECTRON_STANDARD_SHELL_CAPABILITY_IDS;
}
export function createElectronRuntimeBridgeEventName(
  streamId: string,
  eventNamespace = DEFAULT_ELECTRON_RUNTIME_EVENT_NAMESPACE,
): string {
  return `${normalizeRequiredToken(eventNamespace, 'eventNamespace')}:stream:${normalizeRequiredToken(streamId, 'streamId')}`;
}
export async function invokeElectronRuntimeUnary(input: {
  readonly client?: RuntimeGrpcBridgeClient;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly desktopControlHost?: NimiElectronDesktopControlHost;
  readonly desktopSenderAuthorized?: boolean;
  readonly bundledAvatarProfile?: boolean;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}): Promise<ElectronRuntimeBridgeUnaryResponse> {
  const request = parseElectronRuntimeUnaryRequest(input.payload);
  if (input.desktopControlHost && isElectronFormalAppOnlyRuntimeMethod(request, input.bundledAvatarProfile === true)) {
    throw electronDesktopRuntimeMethodNotAdmitted(input.command, request.methodId);
  }
  if (input.bundledAvatarProfile) {
    if (!input.desktopControlHost) {
      throw electronDesktopControlError(
        new NimiElectronDesktopControlHostError('protected-carrier-required', false),
        input.command,
        request.methodId,
      );
    }
    try {
      const responseBytes = await input.desktopControlHost.bundledAvatarUnary({
        methodId: request.methodId,
        requestBytes: fromBase64(request.requestBytesBase64),
        timeoutMs: request.timeoutMs,
        requestId: input.requestId ?? request.requestId,
        signal: input.signal,
      });
      return { responseBytesBase64: toBase64(responseBytes) };
    } catch (error) {
      throw electronDesktopControlError(
        error instanceof NimiElectronDesktopControlHostError
          ? error
          : new NimiElectronDesktopControlHostError('runtime-service-untrusted', false),
        input.command,
        request.methodId,
      );
    }
  }
  const machineProduct = isElectronDesktopMachineProductMethod(request.methodId, 'unary');
  const accountProduct = isElectronDesktopAccountProductMethod(request.methodId, 'unary');
  const machineSelected = machineProduct && (!accountProduct
    || request.productIntent === 'machine.route-connectors.list');
  const accountSelected = accountProduct && (!machineProduct
    || request.productIntent === 'account.connector-admin.list');
  if ((machineProduct && accountProduct && !machineSelected && !accountSelected)
    || (request.productIntent && !(machineProduct && accountProduct))) {
    throw electronDesktopRuntimeMethodNotAdmitted(input.command, request.methodId);
  }
  if (machineSelected || accountSelected) {
    if (!input.desktopControlHost || input.appId !== 'nimi.desktop' || !input.desktopSenderAuthorized) {
      throw electronDesktopControlError(
        new NimiElectronDesktopControlHostError('protected-carrier-required', false),
        input.command,
        request.methodId,
      );
    }
    try {
      const nativeInput = {
        methodId: request.methodId,
        requestBytes: fromBase64(request.requestBytesBase64),
        timeoutMs: request.timeoutMs,
        requestId: input.requestId ?? request.requestId,
        signal: input.signal,
      };
      const responseBytes = machineSelected
        ? await input.desktopControlHost.machineProductUnary(nativeInput)
        : await input.desktopControlHost.accountProductUnary(nativeInput);
      return { responseBytesBase64: toBase64(responseBytes) };
    } catch (error) {
      throw electronDesktopControlError(
        error instanceof NimiElectronDesktopControlHostError
          ? error
          : new NimiElectronDesktopControlHostError('runtime-service-untrusted', false),
        input.command,
        request.methodId,
      );
    }
  }
  if (input.desktopControlHost) {
    throw electronDesktopRuntimeMethodNotAdmitted(input.command, request.methodId);
  }
  assertElectronGenericRuntimeMethodAllowed(request.methodId);
  const client = requireElectronRuntimeClient(input.client, input.command);
  const response = await invokeElectronRuntimeTrustedUnary({
    client,
    request,
    requestBytes: fromBase64(request.requestBytesBase64),
    appId: input.appId,
    event: input.event,
    runtimeEndpoint: input.runtimeEndpoint,
    command: input.command,
    trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
    signal: input.signal,
  });
  return {
    responseBytesBase64: toBase64(response.responseBytes),
    responseMetadata: response.responseMetadata,
  };
}

function electronDesktopControlError(
  error: NimiElectronDesktopControlHostError,
  command: string,
  methodId: string,
): NimiElectronShellHostError {
  const code = error.reasonCode === 'protected-carrier-required'
    ? 'protected-carrier-required'
    : error.reasonCode === 'runtime-service-unavailable'
      ? 'runtime-service-unavailable'
      : error.reasonCode === 'runtime-service-repair-required'
        ? 'runtime-service-repair-required'
        : error.reasonCode === 'runtime-service-untrusted'
          ? 'runtime-service-untrusted'
          : error.reasonCode === 'runtime-service-error-unclassified'
            ? 'runtime-service-error-unclassified'
            : 'runtime-permission-denied';
  return new NimiElectronShellHostError({
    code,
    message: error.reasonCode,
    reasonCode: error.reasonCode,
    actionHint: error.retryable ? 'retry_verified_desktop_control_operation' : 'refresh_desktop_control_projection',
    source: error.reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: {
      command,
      methodId,
      retryable: error.retryable,
      ...(Object.keys(error.reasonMetadata).length > 0
        ? { reasonMetadata: error.reasonMetadata }
        : {}),
    },
  });
}

function electronDesktopRuntimeMethodNotAdmitted(
  command: string,
  methodId: string,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Desktop Runtime method is not admitted on the protected carrier: ${methodId}`,
    reasonCode: 'electron-desktop-runtime-method-not-admitted',
    actionHint: 'use_exact_protected_desktop_runtime_method',
    details: { command, methodId },
  });
}

function electronDesktopRuntimeStreamNotAdmitted(
  command: string,
  methodId: string,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Desktop Runtime stream is not admitted on the protected carrier: ${methodId}`,
    reasonCode: 'electron-desktop-runtime-stream-not-admitted',
    actionHint: 'use_admitted_unary_runtime_refresh',
    details: { command, methodId },
  });
}

function requireElectronRuntimeClient(
  client: RuntimeGrpcBridgeClient | undefined,
  command: string,
): RuntimeGrpcBridgeClient {
  if (client) {
    return client;
  }
  throw new NimiElectronShellHostError({
    code: 'host-internal-error',
    message: 'Electron Runtime client is unavailable for the generic bridge',
    reasonCode: 'electron-runtime-client-unavailable',
    actionHint: 'configure_external_runtime_transport',
    details: { command },
  });
}

export async function invokeElectronRuntimeTrustedUnary(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly request: ElectronRuntimeBridgeUnaryRequest;
  readonly requestBytes: Uint8Array;
  readonly appId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly signal?: AbortSignal;
}): Promise<RuntimeGrpcBridgeUnaryResponse> {
  const request = input.request;
  const metadataInput = {
    provider: input.trustedRuntimeMetadataProvider,
    command: input.command,
    methodId: request.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  };
  const initialResolution = await resolveTrustedRuntimeMetadataWithSingleInvalidation(metadataInput);
  let trusted = initialResolution.trusted;
  let invalidationConsumed = initialResolution.invalidationConsumed;
  let metadata = buildElectronRuntimeGrpcMetadata(request, input.appId, trusted);
  let response: RuntimeGrpcBridgeUnaryResponse;
  try {
    response = await input.client.unary({
      methodId: request.methodId,
      requestBytes: input.requestBytes,
      metadata,
      timeoutMs: request.timeoutMs,
      signal: input.signal,
    });
  } catch (error) {
    const invalidationReason = invalidationConsumed
      || input.signal?.aborted
      ? null
      : trustedRuntimeMetadataInvalidationReason(input.trustedRuntimeMetadataProvider, error);
    if (invalidationReason) {
      invalidationConsumed = true;
      input.trustedRuntimeMetadataProvider?.invalidate?.(invalidationReason);
      trusted = await resolveTrustedRuntimeMetadata(metadataInput);
      metadata = buildElectronRuntimeGrpcMetadata(request, input.appId, trusted);
      try {
        response = await input.client.unary({
          methodId: request.methodId,
          requestBytes: input.requestBytes,
          metadata,
          timeoutMs: request.timeoutMs,
          signal: input.signal,
        });
      } catch (retryError) {
        throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, retryError);
      }
    } else {
      throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
    }
  }
  return response;
}

export async function openElectronRuntimeStream(input: {
  readonly client?: RuntimeGrpcBridgeClient;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly eventNamespace: string;
  readonly eventChannelPrefix: string;
  readonly streams: Map<string, RuntimeGrpcBridgeStream>;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly desktopProtectedOnly?: boolean;
  readonly desktopControlHost?: NimiElectronDesktopControlHost;
  readonly desktopSenderAuthorized?: boolean;
  readonly bundledAvatarProfile?: boolean;
}): Promise<ElectronRuntimeBridgeStreamOpenResponse> {
  const request = parseElectronRuntimeStreamOpenRequest(input.payload);
  if (input.desktopControlHost && isElectronFormalAppOnlyRuntimeMethod(request, input.bundledAvatarProfile === true)) {
    throw electronDesktopRuntimeStreamNotAdmitted(input.command, request.methodId);
  }
  const metadataInput = {
    provider: input.trustedRuntimeMetadataProvider,
    command: input.command,
    methodId: request.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  };
  let initialResolution: {
    readonly trusted: ElectronRuntimeBridgeTrustedMetadata | undefined;
    readonly invalidationConsumed: boolean;
  };
  let createStream: (trusted: ElectronRuntimeBridgeTrustedMetadata | undefined) => RuntimeGrpcBridgeStream;
  const requestBytes = fromBase64(request.requestBytesBase64);
  const machineProduct = isElectronDesktopMachineProductMethod(request.methodId, 'server_stream');
  const accountProduct = isElectronDesktopAccountProductMethod(request.methodId, 'server_stream');
  if (input.bundledAvatarProfile) {
    if (!input.desktopControlHost) {
      throw electronDesktopControlError(
        new NimiElectronDesktopControlHostError('protected-carrier-required', false),
        input.command,
        request.methodId,
      );
    }
    initialResolution = { trusted: undefined, invalidationConsumed: true };
    createStream = () => input.desktopControlHost!.bundledAvatarServerStream({
      methodId: request.methodId,
      requestBytes,
      timeoutMs: request.timeoutMs,
    });
  } else if (machineProduct || accountProduct) {
    if (!input.desktopControlHost || input.appId !== 'nimi.desktop' || !input.desktopSenderAuthorized) {
      throw electronDesktopRuntimeStreamNotAdmitted(input.command, request.methodId);
    }
    initialResolution = { trusted: undefined, invalidationConsumed: true };
    createStream = () => {
      const nativeInput = { methodId: request.methodId, requestBytes, timeoutMs: request.timeoutMs };
      return machineProduct
        ? input.desktopControlHost!.machineProductServerStream(nativeInput)
        : input.desktopControlHost!.accountProductServerStream(nativeInput);
    };
  } else {
    if (input.desktopProtectedOnly) {
      throw electronDesktopRuntimeStreamNotAdmitted(input.command, request.methodId);
    }
    assertElectronGenericRuntimeMethodAllowed(request.methodId);
    const client = requireElectronRuntimeClient(input.client, input.command);
    initialResolution = await resolveTrustedRuntimeMetadataWithSingleInvalidation(metadataInput);
    createStream = (trusted) => client.serverStream({
      methodId: request.methodId,
      requestBytes,
      metadata: buildElectronRuntimeGrpcMetadata(request, input.appId, trusted),
      timeoutMs: request.timeoutMs,
    });
  }
  let invalidationConsumed = initialResolution.invalidationConsumed;
  let stream: RuntimeGrpcBridgeStream;
  try {
    stream = createStream(initialResolution.trusted);
  } catch (error) {
    throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
  }
  const eventName = createElectronRuntimeBridgeEventName(request.streamId, request.eventNamespace || input.eventNamespace);
  const channel = `${input.eventChannelPrefix}${eventName}`;
  let recoveringStream: RuntimeGrpcBridgeStream | null = null;
  const sendStreamError = (error: unknown) => {
    input.event.sender?.send?.(channel, {
      streamId: request.streamId,
      eventType: 'error',
      error: toElectronRuntimeBridgeError(createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error)),
    });
  };
  const startStream = (current: RuntimeGrpcBridgeStream) => {
    current.start({
      onData: (bytes) => {
        if (input.streams.get(request.streamId) !== current) {
          return;
        }
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'next',
          payloadBytesBase64: toBase64(bytes),
        });
      },
      onError: (error) => {
        if (input.streams.get(request.streamId) !== current) {
          return;
        }
        const invalidationReason = invalidationConsumed
          ? null
          : trustedRuntimeMetadataInvalidationReason(input.trustedRuntimeMetadataProvider, error);
        if (!invalidationReason) {
          input.streams.delete(request.streamId);
          sendStreamError(error);
          return;
        }
        invalidationConsumed = true;
        recoveringStream = current;
        input.trustedRuntimeMetadataProvider?.invalidate?.(invalidationReason);
        void (async () => {
          try {
            const trusted = await resolveTrustedRuntimeMetadata(metadataInput);
            if (input.streams.get(request.streamId) !== current) {
              return;
            }
            const replacement = createStream(trusted);
            input.streams.set(request.streamId, replacement);
            recoveringStream = null;
            try {
              startStream(replacement);
            } catch (retryError) {
              if (input.streams.get(request.streamId) === replacement) {
                input.streams.delete(request.streamId);
                sendStreamError(retryError);
              }
            }
          } catch (retryError) {
            if (input.streams.get(request.streamId) === current) {
              recoveringStream = null;
              input.streams.delete(request.streamId);
              sendStreamError(retryError);
            }
          }
        })();
      },
      onEnd: () => {
        if (
          input.streams.get(request.streamId) !== current
          || recoveringStream === current
        ) {
          return;
        }
        input.streams.delete(request.streamId);
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'completed',
        });
      },
    });
  };
  input.streams.set(request.streamId, stream);
  try {
    startStream(stream);
  } catch (error) {
    input.streams.delete(request.streamId);
    throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
  }
  return { streamId: request.streamId };
}

// These exact methods are classified by Runtime's protectedLocalAppUnaryIngress
// and protectedLocalAppStreamIngress even though their names omit "LocalApp".
// Their only renderer carrier is the scoped formal App Host.
const FORMAL_APP_RUNTIME_METHODS: ReadonlySet<string> = new Set([
  '/nimi.runtime.v1.RuntimeAgentService/GetAgentPresentationAsset',
  '/nimi.runtime.v1.RuntimeAgentService/ResolveDesktopAgentReference',
  '/nimi.runtime.v1.RuntimeAiVideoSessionService/OpenVideoSession',
  '/nimi.runtime.v1.RuntimeAiVideoSessionService/SubmitVideoSessionFrame',
  '/nimi.runtime.v1.RuntimeAiVideoSessionService/ReadVideoSessionResult',
  '/nimi.runtime.v1.RuntimeAiVideoSessionService/CloseVideoSession',
  '/nimi.runtime.v1.RuntimeAppActivityService/PutAppActivity',
  '/nimi.runtime.v1.RuntimeAppActivityService/ListAppActivities',
  '/nimi.runtime.v1.RuntimeAppActivityService/MarkAppActivityRead',
  '/nimi.runtime.v1.RuntimeAppActivityService/CompleteAppActivityOpenRequest',
  '/nimi.runtime.v1.RuntimeAppActivityService/ResolveAppActivityOpenLaunch',
  '/nimi.runtime.v1.RuntimeAppActivityService/OpenAppActivity',
  '/nimi.runtime.v1.RuntimeAppActivityService/SubscribeAppActivityChanges',
  '/nimi.runtime.v1.RuntimeAppActivityService/SubscribeAppActivityOpenRequests',
  '/nimi.runtime.v1.RuntimeIntegrationService/ListIntegrationCatalog',
  '/nimi.runtime.v1.RuntimeIntegrationService/ListIntegrationConnections',
  '/nimi.runtime.v1.RuntimeIntegrationService/InvokeIntegrationCall',
  '/nimi.runtime.v1.RuntimeIntegrationService/GetIntegrationCall',
  '/nimi.runtime.v1.RuntimeIntegrationService/ListIntegrationCalls',
  '/nimi.runtime.v1.RuntimeIntegrationService/CancelIntegrationCall',
  '/nimi.runtime.v1.RuntimeIntegrationService/RegisterIntegrationProvider',
  '/nimi.runtime.v1.RuntimeIntegrationService/UnregisterIntegrationProvider',
  '/nimi.runtime.v1.RuntimeIntegrationService/PollIntegrationProvider',
  '/nimi.runtime.v1.RuntimeIntegrationService/CompleteIntegrationProvider',
  '/nimi.runtime.v1.RuntimeIntegrationService/GetIntegrationManagement',
  '/nimi.runtime.v1.RuntimeIntegrationService/PutIntegrationConnection',
  '/nimi.runtime.v1.RuntimeIntegrationService/RemoveIntegrationConnection',
  '/nimi.runtime.v1.RuntimeIntegrationService/SetIntegrationPermission',
]);

const FORMAL_APP_REALM_METHODS: ReadonlySet<string> = new Set([
  'WorldCoreController_listWorldCores',
  'WorldCoreController_createWorldCore',
  'WorldCoreController_getWorldCreationEligibility',
  'WorldCoreController_getWorldCore',
  'WorldCoreController_replaceWorldCore',
  'WorldCoreController_listWorldCharacters',
  'WorldCoreController_getWorldCharacter',
  'WorldCoreController_createWorldCharacter',
  'WorldCoreController_replaceWorldCharacter',
  'WorldCoreController_listWorldEntities',
  'WorldCoreController_getWorldEntity',
  'WorldCoreController_createWorldEntity',
  'WorldCoreController_listWorldRelationships',
  'WorldCoreController_getWorldRelationship',
  'WorldCoreController_listPersonaCharacters',
  'WorldCoreController_getPersonaCharacter',
  'WorldCoreController_createPersonaCharacter',
  'WorldCoreController_replacePersonaCharacter',
  'WorldCoreController_deletePersonaCharacter',
]);

// @nimi-authority: rule.nimi.runtime.protected-session.r017
function isElectronFormalAppOnlyRuntimeMethod(request: ElectronRuntimeBridgeUnaryRequest, avatar: boolean): boolean {
  const methodId = request.methodId;
  // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040e
  // Package management belongs to the exact Desktop machine-product profile;
  // "LocalApp" in an import method's name does not make it an App operation.
  if (methodId.startsWith('/nimi.runtime.v1.RuntimeAppPackageService/')
    && isElectronDesktopMachineProductMethod(methodId, 'unary')) return false;
  const methodName = methodId.slice(methodId.lastIndexOf('/') + 1);
  if (FORMAL_APP_RUNTIME_METHODS.has(methodId)
    || methodName.includes('LocalApp')
    || methodId.startsWith('/nimi.runtime.v1.RuntimeAiRealtimeService/')
    || methodId.startsWith('/nimi.runtime.v1.RuntimeRealmRealtimeService/')) return true;
  try {
    if (methodId === '/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary') {
      const decoded = InvokeRealmUnaryRequest.fromBinary(fromBase64(request.requestBytesBase64));
      return FORMAL_APP_REALM_METHODS.has(decoded.methodId);
    }
    let owner;
    switch (methodId) {
      case '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig':
        owner = GetAppAIConfigRequest.fromBinary(fromBase64(request.requestBytesBase64)).owner;
        break;
      case '/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig':
        owner = OverwriteAppAIConfigRequest.fromBinary(fromBase64(request.requestBytesBase64)).config?.owner;
        break;
      case '/nimi.runtime.v1.RuntimeAiService/ListAppAIConfigOptions':
        owner = ListAppAIConfigOptionsRequest.fromBinary(fromBase64(request.requestBytesBase64)).owner;
        break;
      default:
        return false;
    }
    // Match Runtime's desktopManagedAppAIConfigAssertion: only the Desktop's
    // explicit non-self App owner is a manager call. Avatar has no such branch.
    const appId = owner?.owner.oneofKind === 'app' ? owner.owner.app.appId : '';
    return avatar || !appId || appId.trim() !== appId || appId === 'nimi.desktop';
  } catch {
    // Malformed protobuf cannot establish a distinct manager/broker route.
    return true;
  }
}

export function closeElectronRuntimeStream(
  payload: Readonly<Record<string, unknown>>,
  streams: Map<string, RuntimeGrpcBridgeStream>,
): Record<string, never> {
  const streamId = normalizeRequiredToken(payload.streamId, 'streamId');
  const stream = streams.get(streamId);
  if (stream) {
    stream.cancel();
    streams.delete(streamId);
  }
  return {};
}
export async function probeElectronRuntimeStatus(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly command: string;
}): Promise<Record<string, unknown>> {
  try {
    const response = await input.client.unary({
      methodId: ELECTRON_RUNTIME_STATUS_METHOD_ID,
      requestBytes: new Uint8Array(),
      metadata: buildElectronRuntimeGrpcMetadata({
        methodId: ELECTRON_RUNTIME_STATUS_METHOD_ID,
        requestBytesBase64: '',
      }, input.appId),
      timeoutMs: ELECTRON_RUNTIME_STATUS_TIMEOUT_MS,
    });
    return {
      running: true,
      managed: false,
      launchMode: 'RUNTIME',
      grpcAddr: input.runtimeEndpoint,
      version: response.responseMetadata?.['x-nimi-runtime-version'],
    };
  } catch (error) {
    throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
  }
}
declare const __NIMI_MACOS_RELEASE_REALM_BASE_URL__: string;

// @nimi-authority: rule.nimi.runtime.service-operations.r067
export function resolveElectronRuntimeDefaults(
  deploymentProfile: 'production' | 'local-development' = 'production',
): Record<string, unknown> {
  // This projection mirrors the protected Runtime deployment profile. The
  // renderer and ordinary process environment never select Realm authority.
  const realmBaseUrl = deploymentProfile === 'local-development'
    ? 'http://127.0.0.1:3002'
    : typeof __NIMI_MACOS_RELEASE_REALM_BASE_URL__ !== 'undefined'
      ? __NIMI_MACOS_RELEASE_REALM_BASE_URL__
      : 'https://realm.nimi.ai';
  const normalizedRealmBaseUrl = trimTrailingSlash(realmBaseUrl);
  const defaultJwksUrl = normalizedRealmBaseUrl
    ? `${normalizedRealmBaseUrl}/api/auth/jwks`
    : 'http://localhost:3002/api/auth/jwks';
  const defaultRevocationUrl = normalizedRealmBaseUrl
    ? `${normalizedRealmBaseUrl}/api/auth/sessions/introspect`
    : 'http://localhost:3002/api/auth/sessions/introspect';

  return {
    realm: {
      realmBaseUrl,
      realtimeUrl: '',
      jwksUrl: defaultJwksUrl,
      revocationUrl: defaultRevocationUrl,
      jwtIssuer: realmBaseUrl,
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      targetType: electronEnvValue('NIMI_TARGET_TYPE', ''),
      targetAccountId: electronEnvValue('NIMI_TARGET_ACCOUNT_ID', ''),
      agentId: electronEnvValue('NIMI_AGENT_ID', ''),
      worldId: electronEnvValue('NIMI_WORLD_ID', ''),
      userConfirmedUpload: electronEnvValue('NIMI_USER_CONFIRMED_UPLOAD', '') === '1',
    },
  };
}
function electronEnvValue(key: string, fallback: string): string {
  return normalizeText(process.env[key]) || fallback;
}
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}
const ELECTRON_RUNTIME_STATUS_METHOD_ID = '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth';
const ELECTRON_RUNTIME_STATUS_TIMEOUT_MS = 1_000;
const DEFAULT_ELECTRON_RUNTIME_EVENT_NAMESPACE = 'nimi.shell.runtime';
