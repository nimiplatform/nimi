export type ElectronRuntimeBridgeCommandSuffix =
  | 'unary'
  | 'stream_open'
  | 'stream_close'
  | 'status'
  | 'start'
  | 'restart';

export type ElectronRuntimeBridgeCommandNames = Readonly<Record<ElectronRuntimeBridgeCommandSuffix, string>>;

export type ElectronRuntimeBridgeMetadata = {
  readonly protocolVersion?: string;
  readonly participantProtocolVersion?: string;
  readonly domain?: string;
  readonly traceId?: string;
  readonly idempotencyKey?: string;
  readonly surfaceId?: string;
  readonly clientId?: string;
  readonly extra?: Readonly<Record<string, string>>;
};

export type ElectronRuntimeBridgeTrustedIdentityMetadata = ElectronRuntimeBridgeMetadata & {
  readonly participantId?: string;
  readonly callerKind?: string;
  readonly callerId?: string;
};

export type ElectronRuntimeBridgeAppSession = {
  readonly sessionId: string;
  readonly sessionToken: string;
};

export type ElectronRuntimeBridgeUnaryRequest = {
  readonly methodId: string;
  readonly requestId?: string;
  readonly requestBytesBase64: string;
  readonly productIntent?: string;
  readonly metadata?: ElectronRuntimeBridgeMetadata;
  readonly timeoutMs?: number;
};

export type ElectronRuntimeBridgeUnaryResponse = {
  readonly responseBytesBase64: string;
  readonly responseMetadata?: Readonly<Record<string, string>>;
};

export type ElectronRuntimeBridgeStreamOpenRequest = ElectronRuntimeBridgeUnaryRequest & {
  readonly streamId: string;
  readonly eventNamespace?: string;
};

export type ElectronRuntimeBridgeStreamOpenResponse = {
  readonly streamId: string;
};

export type ElectronRuntimeBridgeStreamCloseRequest = {
  readonly streamId: string;
};

export type ElectronRuntimeBridgeTrustedMetadata = {
  readonly metadata?: ElectronRuntimeBridgeTrustedIdentityMetadata;
  readonly appSession?: ElectronRuntimeBridgeAppSession;
};

export type ElectronRuntimeBridgeTrustedMetadataProviderInput = {
  readonly command: string;
  readonly methodId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
};

export type ElectronRuntimeBridgeTrustedMetadataProvider = {
  (
    input: ElectronRuntimeBridgeTrustedMetadataProviderInput,
  ): Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> | ElectronRuntimeBridgeTrustedMetadata | undefined;
  invalidate?: (reason: string) => void;
};

export type NimiElectronIpcMainInvokeEvent = {
  readonly senderFrame?: {
    readonly origin?: string;
    readonly url?: string;
  } | null;
  readonly sender?: {
    readonly id?: number;
    readonly send?: (channel: string, payload: unknown) => void;
  };
};

export type NimiElectronIpcMain = {
  readonly handle: (
    channel: string,
    listener: (event: NimiElectronIpcMainInvokeEvent, payload: unknown) => Promise<unknown> | unknown,
  ) => void;
  readonly removeHandler?: (channel: string) => void;
};

export type RuntimeGrpcBridgeUnaryRequest = {
  readonly methodId: string;
  readonly requestBytes: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type RuntimeGrpcBridgeUnaryResponse = {
  readonly responseBytes: Uint8Array;
  readonly responseMetadata?: Readonly<Record<string, string>>;
};

export type RuntimeGrpcBridgeStreamRequest = RuntimeGrpcBridgeUnaryRequest;

export type RuntimeGrpcBridgeStreamHandlers = {
  readonly onData: (bytes: Uint8Array) => void;
  readonly onError: (error: unknown) => void;
  readonly onEnd: () => void;
};

export type RuntimeGrpcBridgeStream = {
  readonly start: (handlers: RuntimeGrpcBridgeStreamHandlers) => void;
  readonly cancel: () => void;
};

export type RuntimeGrpcBridgeClient = {
  readonly unary: (request: RuntimeGrpcBridgeUnaryRequest) => Promise<RuntimeGrpcBridgeUnaryResponse>;
  readonly serverStream: (request: RuntimeGrpcBridgeStreamRequest) => RuntimeGrpcBridgeStream;
  readonly close: () => void;
};

export type NimiElectronCommandHandlerInput = {
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly sendEvent?: (eventName: string, payload: unknown) => void;
};

export type NimiElectronCommandHandler = (
  input: NimiElectronCommandHandlerInput,
) => Promise<unknown> | unknown;

export type NimiElectronHostCommandKind = 'standard' | 'app-domain' | 'unknown';

export type NimiElectronHostCommandPolicyDecision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly code?: NimiStandardShellErrorCode;
      readonly reasonCode: string;
      readonly actionHint: string;
      readonly details?: Readonly<Record<string, unknown>>;
    };

export type NimiElectronHostCommandPolicyInput = {
  readonly command: string;
  readonly commandKind: NimiElectronHostCommandKind;
  readonly appId: string;
};

export type NimiElectronHostCommandPolicy = (
  input: NimiElectronHostCommandPolicyInput,
) => NimiElectronHostCommandPolicyDecision | Promise<NimiElectronHostCommandPolicyDecision>;

export type NimiElectronRuntimeDeploymentProfile =
  | 'production'
  | 'local-development';

export type NimiElectronRuntimeLifecycleProfile =
  | 'fixed'
  | 'source';

export type NimiElectronDesktopOpenFetchResponse = {
  readonly ok?: boolean;
  readonly status: number;
  readonly json?: () => Promise<unknown> | unknown;
  readonly text?: () => Promise<string> | string;
};

export type NimiElectronDesktopOpenFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
) => Promise<NimiElectronDesktopOpenFetchResponse> | NimiElectronDesktopOpenFetchResponse;

export type NimiElectronDesktopOpenHost = {
  readonly descriptorPath?: string;
  readonly sourceHost?: 'electron-standard-shell';
  readonly maxHeartbeatAgeMs?: number;
  readonly now?: () => number;
  readonly createRequestId?: () => string;
  readonly readTextFile?: (absolutePath: string) => Promise<string> | string;
  readonly fetch?: NimiElectronDesktopOpenFetch;
};

export type NimiElectronShellUiLevel = 'info' | 'warning' | 'error';

export type NimiElectronConfirmDialogPayload = {
  readonly title: string;
  readonly description: string;
  readonly level?: NimiElectronShellUiLevel;
};

export type NimiElectronConfirmDialogResult = {
  readonly confirmed: boolean;
};

export type NimiElectronShellUiCommandInput = {
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
};

export type NimiElectronShellFileProtocolPrivileges = {
  readonly standard: boolean;
  readonly secure: boolean;
  readonly corsEnabled: boolean;
  readonly supportFetchAPI: boolean;
  readonly stream: boolean;
};

export type NimiElectronShellFileProtocolResponseLike = {
  readonly status?: number;
};

export type NimiElectronShellFileProtocolApi = {
  readonly registerSchemesAsPrivileged: (
    customSchemes: readonly {
      readonly scheme: string;
      readonly privileges: NimiElectronShellFileProtocolPrivileges;
    }[],
  ) => void;
  readonly handle: (
    scheme: string,
    handler: (request: { readonly url: string }) => Promise<NimiElectronShellFileProtocolResponseLike>,
  ) => void;
};

export type NimiElectronShellFileReadableGrantScope = 'external' | 'data-root';

export type NimiElectronShellFileProtocolHost = {
  readonly protocolScheme: string;
  readonly registerPrivilegedSchemes: () => void;
  readonly registerProtocolHandler: () => void;
  readonly registerReadableFile: (
    absolutePath: string,
    scope?: NimiElectronShellFileReadableGrantScope,
  ) => Promise<string>;
  readonly resolveLocalAssetUrl: (absolutePath: string) => string;
  readonly hasReadableFile: (absolutePath: string) => Promise<boolean>;
  readonly quiesceDataRootReadableGrants: () => Promise<void>;
  readonly resumeDataRootReadableGrants: () => void;
  readonly retireDataRootReadableGrants: () => void;
  readonly activateDataRootReadableGrants: () => void;
};

export type NimiElectronFileDialogFilter = {
  readonly name: string;
  readonly extensions: readonly string[];
};

export type NimiElectronFileDialogOpenPayload = {
  readonly kind: 'file' | 'directory';
  readonly title?: string;
  readonly filters?: readonly NimiElectronFileDialogFilter[];
  readonly multiple?: boolean;
};

export type NimiElectronFileDialogOpenResult = {
  readonly canceled: boolean;
  readonly paths: readonly string[];
};

export type NimiElectronFloatingWindowMethod = (
  payload: Readonly<Record<string, unknown>>,
  input: NimiElectronShellUiCommandInput,
) => Promise<Readonly<Record<string, unknown>> | void> | Readonly<Record<string, unknown>> | void;

export type NimiElectronFloatingWindowHost = {
  readonly setBounds?: NimiElectronFloatingWindowMethod;
  readonly setIgnoreCursorEvents?: NimiElectronFloatingWindowMethod;
  readonly setAlwaysOnTop?: NimiElectronFloatingWindowMethod;
  readonly hide?: NimiElectronFloatingWindowMethod;
  readonly close?: NimiElectronFloatingWindowMethod;
  readonly beginManualDrag?: NimiElectronFloatingWindowMethod;
  readonly moveManualDrag?: NimiElectronFloatingWindowMethod;
  readonly constrainToVisibleArea?: NimiElectronFloatingWindowMethod;
};

export type NimiElectronStandardDataRootBinding =
  | { readonly source: 'runtime-get-app-storage' }
  | {
      readonly source: 'product-control-projection';
      readonly resolveDataRoot: () => Promise<string> | string;
    }
  | {
      readonly source: 'runtime-launch-projection';
      readonly durableDataRoot: string;
      readonly cacheRoot?: string;
      readonly tempRoot?: string;
      readonly projectionRef: string;
    };

export type NimiElectronStandardStorageRoots = {
  readonly dataRoot: string;
  readonly cacheRoot?: string;
  readonly tempRoot?: string;
};

export type NimiElectronStandardShellHost = {
  readonly capabilitySetRef?: string;
  readonly allowAllStandardShellCommands?: boolean;
  readonly localAppHost?: import('./local-app-host.js').NimiElectronLocalAppHost;
  readonly localAppAssetMediaHost?: import('./app-asset-protocol.js').NimiElectronLocalAppAssetMediaHost;
  readonly standardDataRootBinding?: NimiElectronStandardDataRootBinding;
  readonly runDataRootOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly localAssetRoots?: readonly string[];
  readonly localAssetProtocolHost?: NimiElectronShellFileProtocolHost;
  readonly openFileDialog?: (
    payload: NimiElectronFileDialogOpenPayload,
  ) => Promise<NimiElectronFileDialogOpenResult> | NimiElectronFileDialogOpenResult;
  readonly revealInOs?: (path: string) => Promise<void> | void;
  readonly exportDirectory?: () => Promise<string> | string;
  readonly floatingWindow?: NimiElectronFloatingWindowHost;
  readonly openExternalUrl?: (url: string) => Promise<void> | void;
  readonly confirmDialog?: (
    payload: NimiElectronConfirmDialogPayload,
    input: NimiElectronShellUiCommandInput,
  ) => Promise<NimiElectronConfirmDialogResult> | NimiElectronConfirmDialogResult;
  readonly startWindowDrag?: (input: NimiElectronShellUiCommandInput) => Promise<void> | void;
  readonly focusMainWindow?: (input: NimiElectronShellUiCommandInput) => Promise<void> | void;
  readonly desktopOpen?: NimiElectronDesktopOpenHost;
};

export type NimiElectronDesktopHost = {
  /** Exact Desktop-owned main WebContents/main-frame authorization. */
  readonly authorizeSender: (event: NimiElectronIpcMainInvokeEvent) => boolean;
  /** Desktop-owned sender destruction or replacement invalidation. */
  readonly subscribeSenderInvalidation: (listener: () => void) => () => void;
};

export type NimiElectronBundledAvatarHost = {
  /** Secondary navigation-integrity URL for the Desktop-created Avatar window. */
  readonly rendererUrl: string;
  /** Non-portable exact sender/main-frame authorization owned by Desktop main. */
  readonly authorizeSender: (event: NimiElectronIpcMainInvokeEvent) => boolean;
  /** Desktop-owned destruction/navigation invalidation for exact sender objects. */
  readonly subscribeSenderInvalidation: (listener: (sender: object) => void) => () => void;
  readonly standardShellHost?: NimiElectronStandardShellHost;
  readonly commandPolicy?: NimiElectronHostCommandPolicy;
  readonly commandHandlers?: Readonly<Record<string, NimiElectronCommandHandler>>;
};

export type RegisterNimiElectronRuntimeBridgeInput = {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  /** Host-build-owned Realm authority projection; renderer and environment cannot select it. */
  readonly runtimeDeploymentProfile?: NimiElectronRuntimeDeploymentProfile;
  /** Host-owned Runtime lifecycle topology; source and installed development must stay distinct. */
  readonly runtimeLifecycleProfile?: NimiElectronRuntimeLifecycleProfile;
  readonly allowedOrigins: readonly string[];
  readonly allowedRendererUrls?: readonly string[];
  readonly ipcMain: NimiElectronIpcMain;
  readonly commandNamespace?: string;
  readonly eventNamespace?: string;
  readonly invokeChannel?: string;
  readonly eventChannelPrefix?: string;
  readonly createGrpcClient?: (endpoint: string) => Promise<RuntimeGrpcBridgeClient> | RuntimeGrpcBridgeClient;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly commandPolicy?: NimiElectronHostCommandPolicy;
  readonly standardShellHost?: NimiElectronStandardShellHost;
  readonly commandHandlers?: Readonly<Record<string, NimiElectronCommandHandler>>;
  /** Fixed Desktop main sender binding; required for first-party product profiles. */
  readonly desktopHost?: NimiElectronDesktopHost;
  /** Fixed Desktop-supervised Avatar profile; valid only for `nimi.desktop`. */
  readonly bundledAvatarHost?: NimiElectronBundledAvatarHost;
};

export type RegisteredNimiElectronRuntimeBridge = {
  readonly invokeChannel: string;
  /** Main-process-only canonical formal host used for Avatar dev bootstrap. */
  readonly bundledAvatarLocalAppHost?: import('./local-app-host.js').NimiElectronLocalAppHost;
  readonly unregister: () => void;
};

export type ElectronShellHostErrorCode =
  NimiStandardShellErrorCode;

export class NimiElectronShellHostError extends Error {
  readonly code: ElectronShellHostErrorCode;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: NimiStandardShellErrorSource;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly envelope: NimiStandardShellErrorEnvelope;

  constructor(input: {
    readonly code: ElectronShellHostErrorCode;
    readonly message: string;
    readonly reasonCode: string;
    readonly actionHint: string;
    readonly source?: NimiStandardShellErrorSource;
    readonly details?: Readonly<Record<string, unknown>>;
  }) {
    super(input.message);
    this.name = 'NimiElectronShellHostError';
    this.code = input.code;
    this.reasonCode = input.reasonCode;
    this.actionHint = input.actionHint;
    this.source = input.source ?? 'electron';
    this.details = input.details;
    this.envelope = {
      code: input.code,
      reasonCode: input.reasonCode,
      actionHint: input.actionHint,
      source: this.source,
      details: input.details ? { ...input.details } : undefined,
    };
  }
}
import type {
  NimiStandardShellErrorCode,
  NimiStandardShellErrorEnvelope,
  NimiStandardShellErrorSource,
} from '@nimiplatform/kit/shell/capabilities';
