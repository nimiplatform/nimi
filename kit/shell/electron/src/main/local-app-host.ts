import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';

const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';
const MACOS_ARM64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-darwin-arm64';
const MAX_PERSONA_REQUEST_BYTES = 2 * 1024 * 1024;

const LOCAL_APP_BINDING_METHODS = [
  'localAppSessionStatus',
  'localAppSessionRenew',
  'localAppAIConfigGet',
  'localAppModelConfigLocalSelectionsGet',
  'localAppTextGenerateCandidate',
  'localAppTextTurnSubscribe',
  'localAppTextTurnStreamNext',
  'localAppTextTurnStreamClose',
  'localAppScenarioExecute',
  'localAppScenarioJobSubmit',
  'localAppScenarioJobGet',
  'localAppScenarioJobSubscribe',
  'localAppScenarioJobStreamNext',
  'localAppScenarioJobStreamClose',
  'localAppScenarioJobCancel',
  'localAppArtifactRead',
  'localAppArtifactUpload',
  'localAppVoiceAssetsList',
  'localAppRealmWorldCoreList',
  'localAppRealmWorldCoreCreate',
  'localAppRealmPersonaCharacterListOwned',
  'localAppRealmPersonaCharacterGetOwned',
  'localAppRealmPersonaCharacterCreate',
  'localAppRealmPersonaCharacterReplace',
  'localAppAgentReferenceList',
  'localAppStorageReadJson',
  'localAppStorageWriteJson',
  'localAppStorageRemoveJson',
  'localAppAssetStat',
  'localAppAssetList',
  'localAppAssetWriteOpen',
  'localAppAssetWriteChunk',
  'localAppAssetWriteCommit',
  'localAppAssetWriteAbort',
  'localAppAssetReadOpen',
  'localAppAssetReadNext',
  'localAppAssetReadClose',
  'localAppAssetRemove',
  'localAppAssetMove',
  'localAppAssetReveal',
  'localAppAssetAdopt',
  'localAppConversationOpen',
  'localAppConversationSendTurn',
  'localAppConversationInterruptTurn',
  'localAppConversationSubscribe',
  'localAppConversationStreamNext',
  'localAppConversationStreamClose',
  'localAppConversationSnapshot',
  'localAppSharedAgentAIConfigGet',
  'localAppSharedAgentAIConfigOverwrite',
  'localAppAgentAutonomySnapshot',
  'localAppAgentUpdateAutonomy',
  'localAppAgentPresentationSnapshot',
  'localAppAgentCommitPresentation',
] as const;

const ADMITTED_REASON_CODES: ReadonlySet<string> = new Set([
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-error-unclassified',
  'runtime-service-repair-required',
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'presence-expired',
  'runtime-access-denied',
  'ai-model-not-found',
  'ai-model-not-ready',
  'ai-provider-unavailable',
  'ai-route-unsupported',
  'ai-route-fallback-denied',
  'ai-input-invalid',
  'ai-output-invalid',
  'ai-content-filter-blocked',
  'ai-local-model-unavailable',
  'ai-local-model-profile-missing',
  'ai-local-service-unavailable',
  'ai-local-driver-unavailable',
  'ai-local-asset-incompatible',
  'ai-local-selection-not-found',
  'ai-local-capability-mismatch',
  'ai-local-configuration-not-configured',
  'ai-provider-auth-failed',
  'ai-provider-internal',
  'ai-provider-rate-limited',
  'ai-provider-timeout',
  'ai-media-spec-invalid',
  'ai-media-option-unsupported',
  'ai-voice-input-invalid',
  'ai-voice-workflow-unsupported',
  'ai-voice-asset-not-found',
  'ai-voice-asset-expired',
  'ai-voice-asset-scope-forbidden',
  'ai-voice-target-model-mismatch',
  'ai-voice-job-not-found',
  'ai-voice-job-not-cancellable',
  'local-app-operation-unavailable',
  'local-app-snapshot-unavailable',
  'local-app-access-denied',
  'local-app-operation-unsupported',
  'local-app-owner-unavailable',
  'capability-unavailable',
  'invalid-input',
  'session-invalid',
  'access-denied',
  'owner-authority-missing',
  'content-conflict',
  'realm-unavailable',
  'rate-limited',
  'upstream-failed',
  'contract-invalid',
  'request-too-large',
  'response-too-large',
  'ai-config-invalid',
  'ai-config-not-found',
  'ai-config-persistence-unavailable',
  'invalid-payload',
  'not-found',
  'resource-exhausted',
  'invalid-path',
  'already-exists',
  'object-too-large',
  'invalid-range',
  'invalid-cursor',
  'integrity-failure',
  'artifact-unavailable',
  'canceled',
  'host-internal-error',
] as const);

const ADMITTED_REASON_METADATA_KEYS: ReadonlySet<string> = new Set([
  'diagnostic_stage',
  'local_development_reason_code',
  'capability',
  'grpc_status_code',
]);

const FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'account', 'accountid', 'accesstoken', 'authorization', 'binding', 'bindingid',
  'connectorgrant', 'connectorgrantid', 'credential', 'custody', 'custodymaterial',
  'grantid', 'providercredential', 'refreshtoken', 'token',
]);

const FORBIDDEN_PROJECTION_KEYS: ReadonlySet<string> = new Set([
  'endpoint',
  'authorization',
  'token',
  'localAppPrincipalId',
  'localAppRecordId',
  'trustClass',
  'provenanceRevision',
  'launchLease',
  'bootstrap',
  'processId',
  'sessionId',
  'sessionProof',
  'accountId',
  'grantId',
  'runtimeBootEpoch',
  'registeredAppSubject',
  'registrationHandle',
  'sourceGeneration',
  'declarationGeneration',
  'accountGeneration',
  'snapshotId',
  'credential',
  'peerProof',
  'classification',
  'domainId',
  'operationId',
] as const);

export type NimiElectronLocalAppJson =
  | null
  | boolean
  | number
  | string
  | readonly NimiElectronLocalAppJson[]
  | { readonly [key: string]: NimiElectronLocalAppJson };

export type NimiElectronLocalAppRecord = {
  readonly [key: string]: NimiElectronLocalAppJson;
};

type NimiElectronLocalAppArtifactUploadBindingInput = {
  readonly bytes: Buffer;
  readonly mimeType: string;
};

type NativeLocalAppOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
      readonly reasonMetadata?: unknown;
    };

type NativeLocalAppBytesOutcome = NativeLocalAppOutcome & {
  readonly value?: Buffer | Uint8Array | null;
  readonly completed?: boolean;
};

export type NimiElectronLocalAppAssetReadNext =
  | { readonly completed: true }
  | { readonly completed: false; readonly bodyChunk: Uint8Array };

export type NimiElectronProtectedLocalBinding = {
  readonly localAppSessionStatus: () => Promise<NativeLocalAppOutcome>;
  readonly localAppSessionRenew: () => Promise<NativeLocalAppOutcome>;
  readonly localAppAIConfigGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppModelConfigLocalSelectionsGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppTextGenerateCandidate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextTurnSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextTurnStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextTurnStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioExecute: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobSubmit: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobGet: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobCancel: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppArtifactRead: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppArtifactUpload: (input: NimiElectronLocalAppArtifactUploadBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppVoiceAssetsList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterListOwned: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterGetOwned: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterReplace: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentReferenceList: () => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetStat: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteChunk: (input: { readonly streamId: string; readonly bodyChunk: Buffer }) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteCommit: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteAbort: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetReadOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetReadNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppBytesOutcome>;
  readonly localAppAssetReadClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetRemove: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetMove: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetReveal: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetAdopt: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationInterruptTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppSharedAgentAIConfigGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppSharedAgentAIConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentAutonomySnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentUpdateAutonomy: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentPresentationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentCommitPresentation: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
};

export type NimiElectronLocalAppHost = {
  readonly sessionStatus: () => Promise<NimiElectronLocalAppRecord>;
  readonly renewTechnicalSession: () => Promise<NimiElectronLocalAppRecord>;
  readonly aiConfigGet: () => Promise<NimiElectronLocalAppRecord>;
  readonly modelConfigLocalSelectionsGet: () => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly textGenerateCandidate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textTurnSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textTurnStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textTurnStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioExecute: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobSubmit: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobGet: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobCancel: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly artifactRead: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly artifactUpload: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly voiceAssetsList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCoreList: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmWorldCoreCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterListOwned: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmPersonaCharacterGetOwned: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterReplace: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentReferenceList: () => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly storageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetStat: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteChunk: (input: Readonly<Record<string, unknown>>) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteCommit: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteAbort: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetReadOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetReadNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppAssetReadNext>;
  readonly assetReadClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetRemove: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetMove: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetReveal: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetAdopt: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationInterruptTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly sharedAgentAIConfigGet: () => Promise<NimiElectronLocalAppRecord>;
  readonly sharedAgentAIConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentAutonomySnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentUpdateAutonomy: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentPresentationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentCommitPresentation: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
};

export type NimiElectronLocalAppMaintenanceFailure = {
  readonly reasonCode: string;
  readonly retryable: boolean;
};

const LOCAL_APP_SESSION_ROTATION_INTERVAL_MS = 5 * 60 * 1_000;
const LOCAL_APP_SESSION_REBIND_TIMEOUT_MS = 2_000;
const LOCAL_APP_SESSION_INVALID_REASONS: ReadonlySet<string> = new Set([
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'local-app-snapshot-unavailable',
]);

export class NimiElectronLocalAppHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly reasonMetadata: Readonly<Record<string, string>>;

  constructor(
    reasonCode: string,
    retryable: boolean,
    reasonMetadata: Readonly<Record<string, string>> = {},
  ) {
    super(reasonCode);
    this.name = 'NimiElectronLocalAppHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.reasonMetadata = Object.freeze({ ...reasonMetadata });
  }
}

function withBoundedSessionRebind(
  binding: NimiElectronProtectedLocalBinding,
  onSessionChange: () => void,
): NimiElectronProtectedLocalBinding {
  let rebindInFlight: Promise<NativeLocalAppOutcome> | undefined;
  const renew = (): Promise<NativeLocalAppOutcome> => {
    rebindInFlight ??= boundedSessionRenew(binding).finally(() => {
      rebindInFlight = undefined;
    });
    return rebindInFlight;
  };
  return new Proxy(binding, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string'
        || typeof value !== 'function'
        || property === 'localAppSessionStatus'
        || property === 'localAppSessionRenew'
        || !LOCAL_APP_BINDING_METHODS.includes(property as typeof LOCAL_APP_BINDING_METHODS[number])
      ) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args: unknown[]): Promise<NativeLocalAppOutcome> => {
        const first = await Reflect.apply(value, target, args) as NativeLocalAppOutcome;
        if (!isSessionInvalidOutcome(first)) {
          return first;
        }
        const rebound = await renew();
        if (!isReadySessionOutcome(rebound)) {
          return rebound.status === 'error' ? rebound : untrustedNativeOutcome();
        }
        onSessionChange();
        return Reflect.apply(value, target, args) as Promise<NativeLocalAppOutcome>;
      };
    },
  });
}

async function boundedSessionRenew(
  binding: NimiElectronProtectedLocalBinding,
): Promise<NativeLocalAppOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      binding.localAppSessionRenew().catch(() => untrustedNativeOutcome()),
      new Promise<NativeLocalAppOutcome>((resolve) => {
        timer = setTimeout(() => resolve({
          status: 'error', reasonCode: 'runtime-service-unavailable', retryable: true,
        }), LOCAL_APP_SESSION_REBIND_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isSessionInvalidOutcome(outcome: NativeLocalAppOutcome): boolean {
  return outcome?.status === 'error' && LOCAL_APP_SESSION_INVALID_REASONS.has(outcome.reasonCode);
}

function isReadySessionOutcome(outcome: NativeLocalAppOutcome): boolean {
  if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) return false;
  if (!hasExactKeys(outcome.value, ['state', 'reasonCode', 'retryable', 'currentUser'])
    || outcome.value.state !== 'ready'
    || outcome.value.reasonCode !== 'action-executed'
    || outcome.value.retryable !== false
    || !isPlainRecord(outcome.value.currentUser)
    || !hasExactKeys(outcome.value.currentUser, ['state', 'value', 'reasonCode', 'retryable'])) return false;
  const currentUser = outcome.value.currentUser;
  if (currentUser.state === 'unavailable') {
    return currentUser.value === null
      && currentUser.reasonCode === 'current-user-display-unavailable'
      && currentUser.retryable === true;
  }
  return currentUser.state === 'ready'
    && isPlainRecord(currentUser.value)
    && hasExactKeys(currentUser.value, ['handle', 'displayName', 'avatarUrl'])
    && currentUser.reasonCode === 'action-executed'
    && currentUser.retryable === false;
}

function untrustedNativeOutcome(): NativeLocalAppOutcome {
  return { status: 'error', reasonCode: 'runtime-service-untrusted', retryable: false };
}

class ElectronLocalAppHost implements NimiElectronLocalAppHost {
  private readonly binding: NimiElectronProtectedLocalBinding;
  private readonly onSessionChange: () => void;
  private readonly textTurnStreams = new Map<string, { bytes: number; sequence: bigint }>();

  constructor(binding: NimiElectronProtectedLocalBinding, onSessionChange: () => void = () => undefined) {
    this.onSessionChange = onSessionChange;
    this.binding = withBoundedSessionRebind(binding, onSessionChange);
  }

  sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSessionStatus());
  }

  async renewTechnicalSession(): Promise<NimiElectronLocalAppRecord> {
    const renewed = await invokeRecord(() => this.binding.localAppSessionRenew());
    this.onSessionChange();
    return renewed;
  }

  aiConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return invokePortableAppAIConfig(() => this.binding.localAppAIConfigGet());
  }

  modelConfigLocalSelectionsGet(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeModelConfigLocalSelections(
      () => this.binding.localAppModelConfigLocalSelectionsGet(),
    );
  }

  textGenerateCandidate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeTextCandidate(() => this.binding.localAppTextGenerateCandidate(input));
  }

  async textTurnSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const opened = await invokeExactTextRecord(() => this.binding.localAppTextTurnSubscribe(input), ['streamId']);
    this.textTurnStreams.set(String(opened.streamId), { bytes: 0, sequence: 0n });
    return opened;
  }

  async textTurnStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const streamId = String(input.streamId);
    const state = this.textTurnStreams.get(streamId);
    if (!state) throw untrustedRuntimeError();
    const next = await invokeScenarioStreamNext(
      () => this.binding.localAppTextTurnStreamNext(input),
      validateTextTurnEvent,
    );
    if (next.completed === true) {
      this.textTurnStreams.delete(streamId);
      return next;
    }
    const event = next.event;
    if (!isPlainRecord(event) || typeof event.sequence !== 'string') throw untrustedRuntimeError();
    const sequence = BigInt(event.sequence);
    if (sequence !== state.sequence + 1n) throw untrustedRuntimeError();
    state.sequence = sequence;
    if (event.type === 'delta' && typeof event.text === 'string') {
      state.bytes += Buffer.byteLength(event.text, 'utf8');
      if (state.bytes > 256 * 1024) {
        this.textTurnStreams.delete(streamId);
        throw untrustedRuntimeError();
      }
    }
    return next;
  }

  async textTurnStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    this.textTurnStreams.delete(String(input.streamId));
    return invokeConversationStreamClose(() => this.binding.localAppTextTurnStreamClose(input));
  }

  scenarioExecute(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioExecute(() => this.binding.localAppScenarioExecute(input));
  }

  scenarioJobSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioJobSubmit(() => this.binding.localAppScenarioJobSubmit(input));
  }

  scenarioJobGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioJobGet(() => this.binding.localAppScenarioJobGet(input));
  }

  scenarioJobSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppScenarioJobSubscribe(input), ['streamId']);
  }

  scenarioJobStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioStreamNext(() => this.binding.localAppScenarioJobStreamNext(input), validateScenarioJobEvent);
  }

  scenarioJobStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppScenarioJobStreamClose(input));
  }

  scenarioJobCancel(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioJobEnvelope(() => this.binding.localAppScenarioJobCancel(input));
  }

  artifactRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeArtifactRead(() => this.binding.localAppArtifactRead(input));
  }

  artifactUpload(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const bytes = validateByteArray(input.bytes);
    const mimeType = boundedImageMime(input.mimeType);
    if (bytes.length === 0) throw untrustedRuntimeError();
    return invokeArtifactUpload(
      () => this.binding.localAppArtifactUpload({ bytes: Buffer.from(bytes), mimeType }),
      bytes.length,
      mimeType,
    );
  }

  voiceAssetsList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeVoiceAssetsList(() => this.binding.localAppVoiceAssetsList(input));
  }

  realmWorldCoreList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeWorldCoreList(() => this.binding.localAppRealmWorldCoreList(input));
  }

  realmWorldCoreCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCore(() => this.binding.localAppRealmWorldCoreCreate({ body: input }));
  }

  realmPersonaCharacterListOwned(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    validatePersonaCharacterListInput(input);
    return invokePersonaCharacterList(() => this.binding.localAppRealmPersonaCharacterListOwned(input));
  }

  realmPersonaCharacterGetOwned(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    if (!hasExactKeys(input, ['personaCharacterId'])) throw untrustedRuntimeError();
    exactText(input.personaCharacterId);
    return invokePersonaCharacter(() => this.binding.localAppRealmPersonaCharacterGetOwned(input));
  }

  realmPersonaCharacterCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    validatePersonaCharacterWriteInput(input, false);
    return invokePersonaCharacter(() => this.binding.localAppRealmPersonaCharacterCreate({ body: input }));
  }

  realmPersonaCharacterReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const personaCharacterId = exactText(input.personaCharacterId);
    const body = input.body;
    if (!isPlainRecord(body)) throw untrustedRuntimeError();
    validatePersonaCharacterWriteInput({ personaCharacterId, ...body }, true);
    return invokePersonaCharacter(() => this.binding.localAppRealmPersonaCharacterReplace({ personaCharacterId, body }));
  }

  agentReferenceList(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeAgentReferenceList(() => this.binding.localAppAgentReferenceList());
  }

  storageReadJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageDocument(() => this.binding.localAppStorageReadJson(input));
  }

  storageWriteJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageDocument(() => this.binding.localAppStorageWriteJson(input));
  }

  storageRemoveJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageRemove(() => this.binding.localAppStorageRemoveJson(input));
  }

  assetStat(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetStat(input));
  }

  assetList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetList(() => this.binding.localAppAssetList(input));
  }

  assetWriteOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppAssetWriteOpen(input), ['streamId']);
  }

  assetWriteChunk(input: Readonly<Record<string, unknown>>): Promise<NimiElectronLocalAppRecord> {
    if (typeof input.streamId !== 'string' || !(input.bodyChunk instanceof Uint8Array)
      || input.bodyChunk.byteLength === 0 || input.bodyChunk.byteLength > 1024 * 1024) throw untrustedRuntimeError();
    const bodyChunk = input.bodyChunk;
    return invokeExactBooleanRecord(
      () => this.binding.localAppAssetWriteChunk({ streamId: input.streamId as string, bodyChunk: Buffer.from(bodyChunk) }),
      'accepted',
    );
  }

  assetWriteCommit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetWriteCommit(input));
  }

  assetWriteAbort(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetWriteAbort(input), 'closed');
  }

  assetReadOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetReadOpen(() => this.binding.localAppAssetReadOpen(input));
  }

  assetReadNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppAssetReadNext> {
    return invokeAssetReadNext(() => this.binding.localAppAssetReadNext(input));
  }

  assetReadClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetReadClose(input), 'closed');
  }

  assetRemove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetRemove(input), 'removed');
  }

  assetMove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetMove(input));
  }

  assetReveal(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetReveal(input), 'revealed');
  }

  assetAdopt(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetAdopt(input));
  }

  conversationOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationOpen(() => this.binding.localAppConversationOpen(input));
  }

  conversationSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationSendTurn(input), ['turnId']);
  }

  conversationInterruptTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationInterruptTurn(input), ['turnId']);
  }

  conversationSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationSubscribe(input), ['streamId']);
  }

  conversationStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamNext(() => this.binding.localAppConversationStreamNext(input));
  }

  conversationStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppConversationStreamClose(input));
  }

  conversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationSnapshot(() => this.binding.localAppConversationSnapshot(input));
  }

  sharedAgentAIConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSharedAgentAIConfigGet());
  }

  sharedAgentAIConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSharedAgentAIConfigOverwrite(input));
  }

  agentAutonomySnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentAutonomySnapshot(input));
  }

  agentUpdateAutonomy(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentUpdateAutonomy(input));
  }

  agentPresentationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentPresentationSnapshot(input));
  }

  agentCommitPresentation(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentCommitPresentation(input));
  }

}

class LazyElectronLocalAppHost implements NimiElectronLocalAppHost {
  private host: NimiElectronLocalAppHost | undefined;

  constructor(private readonly onSessionChange: () => void = () => undefined) {}

  private resolve(): NimiElectronLocalAppHost {
    this.host ??= new ElectronLocalAppHost(loadPlatformBinding(), this.onSessionChange);
    return this.host;
  }

  sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sessionStatus();
  }

  renewTechnicalSession(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().renewTechnicalSession();
  }

  aiConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().aiConfigGet();
  }

  modelConfigLocalSelectionsGet(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().modelConfigLocalSelectionsGet();
  }

  textGenerateCandidate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textGenerateCandidate(input);
  }

  textTurnSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textTurnSubscribe(input);
  }

  textTurnStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textTurnStreamNext(input);
  }

  textTurnStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textTurnStreamClose(input);
  }

  scenarioExecute(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioExecute(input);
  }

  scenarioJobSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobSubmit(input);
  }

  scenarioJobGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobGet(input);
  }

  scenarioJobSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobSubscribe(input);
  }

  scenarioJobStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobStreamNext(input);
  }

  scenarioJobStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobStreamClose(input);
  }

  scenarioJobCancel(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobCancel(input);
  }

  artifactRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().artifactRead(input);
  }

  artifactUpload(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().artifactUpload(input);
  }

  voiceAssetsList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().voiceAssetsList(input);
  }

  realmWorldCoreList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmWorldCoreList(input);
  }

  realmWorldCoreCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCoreCreate(input);
  }

  realmPersonaCharacterListOwned(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmPersonaCharacterListOwned(input);
  }

  realmPersonaCharacterGetOwned(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterGetOwned(input);
  }

  realmPersonaCharacterCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterCreate(input);
  }

  realmPersonaCharacterReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterReplace(input);
  }

  agentReferenceList(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().agentReferenceList();
  }

  storageReadJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageReadJson(input);
  }

  storageWriteJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageWriteJson(input);
  }

  storageRemoveJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageRemoveJson(input);
  }

  assetStat(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetStat(input); }
  assetList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetList(input); }
  assetWriteOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteOpen(input); }
  assetWriteChunk(input: Readonly<Record<string, unknown>>): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteChunk(input); }
  assetWriteCommit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteCommit(input); }
  assetWriteAbort(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteAbort(input); }
  assetReadOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetReadOpen(input); }
  assetReadNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppAssetReadNext> { return this.resolve().assetReadNext(input); }
  assetReadClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetReadClose(input); }
  assetRemove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetRemove(input); }
  assetMove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetMove(input); }
  assetReveal(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetReveal(input); }
  assetAdopt(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetAdopt(input); }

  conversationOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationOpen(input);
  }

  conversationSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSendTurn(input);
  }

  conversationInterruptTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationInterruptTurn(input);
  }

  conversationSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSubscribe(input);
  }

  conversationStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationStreamNext(input);
  }

  conversationStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationStreamClose(input);
  }

  conversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSnapshot(input);
  }

  sharedAgentAIConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sharedAgentAIConfigGet();
  }

  sharedAgentAIConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sharedAgentAIConfigOverwrite(input);
  }

  agentAutonomySnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentAutonomySnapshot(input);
  }

  agentUpdateAutonomy(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentUpdateAutonomy(input);
  }

  agentPresentationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentPresentationSnapshot(input);
  }

  agentCommitPresentation(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentCommitPresentation(input);
  }

}

export function createNimiElectronLocalAppHost(
  onSessionChange: () => void = () => undefined,
): NimiElectronLocalAppHost {
  return new LazyElectronLocalAppHost(onSessionChange);
}

/**
 * Starts the request-empty native session bootstrap from Electron main.
 * The renderer still receives only the sanitized status projection, while a
 * cold renderer build cannot consume the Runtime's exact process-bind window.
 */
export async function primeNimiElectronLocalAppHost(
  host: NimiElectronLocalAppHost,
): Promise<void> {
  await host.sessionStatus();
}

/** @internal Keeps Runtime-owned technical session rotation outside renderer state. */
export function startNimiElectronLocalAppHostMaintenance(
  host: NimiElectronLocalAppHost,
  intervalMs = LOCAL_APP_SESSION_ROTATION_INTERVAL_MS,
  onFailure: (failure: NimiElectronLocalAppMaintenanceFailure) => void = () => undefined,
): { readonly ready: Promise<void>; readonly close: () => void } {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Electron local-app session rotation interval is invalid');
  }
  let closed = false;
  let failed = false;
  let rotating = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    closed = true;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    close();
    const failure = error instanceof NimiElectronLocalAppHostError
      ? { reasonCode: error.reasonCode, retryable: error.retryable }
      : { reasonCode: 'runtime-service-untrusted', retryable: false };
    try {
      onFailure(Object.freeze(failure));
    } catch {
      // The protected bridge is already closed by the owner callback. A shell
      // lifecycle callback cannot turn failed renewal back into a live session.
    }
  };
  const rotate = async () => {
    if (closed || rotating) return;
    rotating = true;
    try {
      await host.renewTechnicalSession();
    } catch (error) {
      fail(error);
    } finally {
      rotating = false;
    }
  };
  const ready = primeNimiElectronLocalAppHost(host).then(() => {
    if (closed) return;
    timer = setInterval(() => void rotate(), intervalMs);
    timer.unref?.();
  }, (error: unknown) => {
    fail(error);
    throw error;
  });
  return { ready, close };
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronLocalAppHostForBinding(
  binding: NimiElectronProtectedLocalBinding,
  onSessionChange: () => void = () => undefined,
): NimiElectronLocalAppHost {
  return new ElectronLocalAppHost(validateBinding(binding), onSessionChange);
}

/** @internal Platform-package resolver used by release and fail-closed tests. */
export function resolveNimiElectronProtectedLocalBindingPackage(platform: string, architecture: string): string {
  if (platform === 'win32' && architecture === 'x64') return WINDOWS_X64_BINDING_PACKAGE;
  if (platform === 'darwin' && architecture === 'arm64') return MACOS_ARM64_BINDING_PACKAGE;
  throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
}

function loadPlatformBinding(): NimiElectronProtectedLocalBinding {
  const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
  try {
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw error;
    throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronProtectedLocalBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrustedRuntimeError();
  const candidate = value as Record<string, unknown>;
  if (LOCAL_APP_BINDING_METHODS.some((method) => typeof candidate[method] !== 'function')) {
    throw untrustedRuntimeError();
  }
  return candidate as NimiElectronProtectedLocalBinding;
}

async function invoke(call: () => Promise<NativeLocalAppOutcome>): Promise<unknown> {
  let outcome: NativeLocalAppOutcome;
  try {
    outcome = await call();
  } catch {
    throw untrustedRuntimeError();
  }
  if (outcome?.status === 'error') {
    const reasonCode = typeof outcome.reasonCode === 'string' ? outcome.reasonCode : '';
    if (!ADMITTED_REASON_CODES.has(reasonCode) || typeof outcome.retryable !== 'boolean') {
      throw untrustedRuntimeError();
    }
    throw new NimiElectronLocalAppHostError(
      reasonCode,
      outcome.retryable,
      validateReasonMetadata(outcome.reasonMetadata),
    );
  }
  if (outcome?.status !== 'ok' || !Object.hasOwn(outcome, 'value')) throw untrustedRuntimeError();
  return outcome.value;
}

async function invokeRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return validateProjection(await invoke(call));
}

async function invokePortableAppAIConfig(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invokeRecord(call);
  rejectPortableAppAIConfigProjection(value);
  return value;
}

function rejectPortableAppAIConfigProjection(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectPortableAppAIConfigProjection(entry);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
    if (FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS.has(normalized)) {
      throw untrustedRuntimeError();
    }
    rejectPortableAppAIConfigProjection(entry);
  }
}

async function invokeTextCandidate(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['text', 'finishReason', 'traceId'])
    || typeof value.text !== 'string'
    || !value.text.trim()
    || Buffer.byteLength(value.text, 'utf8') > 256 * 1024
    || (value.finishReason !== 'stop'
      && value.finishReason !== 'length'
      && value.finishReason !== 'content-filter')) {
    throw untrustedRuntimeError();
  }
  const traceId = exactText(value.traceId);
  return Object.freeze({ text: value.text, finishReason: value.finishReason, traceId });
}

async function invokeScenarioExecute(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['output', 'traceId']) || !isPlainRecord(value.output)) {
    throw untrustedRuntimeError();
  }
  const traceId = boundedExactText(value.traceId, 512, false);
  const output = value.output;
  if (output.type === 'text-embed') {
    if (!hasExactKeys(output, ['type', 'vectors']) || !Array.isArray(output.vectors)
      || output.vectors.length === 0 || output.vectors.length > 16) throw untrustedRuntimeError();
    const vectors = output.vectors.map((vector) => {
      if (!Array.isArray(vector) || vector.length === 0 || vector.length > 8192
        || vector.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
        throw untrustedRuntimeError();
      }
      return Object.freeze([...vector]);
    });
    return Object.freeze({ output: Object.freeze({ type: 'text-embed', vectors: Object.freeze(vectors) }), traceId });
  }
  if (output.type === 'image-generate') {
    if (!hasExactKeys(output, ['type', 'artifacts']) || !Array.isArray(output.artifacts)) throw untrustedRuntimeError();
    return Object.freeze({
      output: Object.freeze({ type: 'image-generate', artifacts: validateScenarioArtifacts(output.artifacts) }),
      traceId,
    });
  }
  throw untrustedRuntimeError();
}

async function invokeScenarioJobSubmit(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['job'])) throw untrustedRuntimeError();
  return Object.freeze({ job: validateScenarioJob(value.job) });
}

async function invokeScenarioJobGet(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['job', 'asset', 'voiceReference'])) {
    throw untrustedRuntimeError();
  }
  const job = validateScenarioJob(value.job);
  const asset = value.asset === null ? null : validateVoiceAsset(value.asset);
  const voiceReference = value.voiceReference === null
    ? null
    : validateVoiceAssetReference(value.voiceReference);
  if ((asset === null) !== (voiceReference === null)
    || (asset !== null && (asset.status !== 'active' || voiceReference?.voiceAssetId !== asset.voiceAssetId))
    || ((job.scenarioType === 'voice-create' && job.status === 'completed') !== (asset !== null))) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    job,
    asset,
    voiceReference,
  });
}

async function invokeScenarioJobEnvelope(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['job'])) throw untrustedRuntimeError();
  return Object.freeze({ job: validateScenarioJob(value.job) });
}

async function invokeArtifactRead(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['bytes', 'mimeType', 'sizeBytes'])) {
    throw untrustedRuntimeError();
  }
  const bytes = validateByteArray(value.bytes);
  const sizeBytes = boundedInteger(value.sizeBytes, 0, 32 * 1024 * 1024);
  if (sizeBytes !== bytes.length) throw untrustedRuntimeError();
  return Object.freeze({ bytes, mimeType: boundedMime(value.mimeType), sizeBytes });
}

async function invokeArtifactUpload(
  call: () => Promise<NativeLocalAppOutcome>,
  expectedSize: number,
  expectedMimeType: string,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['artifactId', 'sizeBytes', 'mimeType'])) {
    throw untrustedRuntimeError();
  }
  const artifactId = boundedExactText(value.artifactId, 128, false);
  const sizeBytes = boundedInteger(value.sizeBytes, 1, 32 * 1024 * 1024);
  const mimeType = boundedImageMime(value.mimeType);
  if (sizeBytes !== expectedSize || mimeType !== expectedMimeType) throw untrustedRuntimeError();
  return Object.freeze({ artifactId, sizeBytes, mimeType });
}

async function invokeVoiceAssetsList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['assets', 'nextPageToken'])
    || !Array.isArray(value.assets) || value.assets.length > 200
    || typeof value.nextPageToken !== 'string' || !/^[0-9]{0,10}$/u.test(value.nextPageToken)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    assets: Object.freeze(value.assets.map(validateVoiceAsset)),
    nextPageToken: value.nextPageToken,
  });
}

async function invokeScenarioStreamNext(
  call: () => Promise<NativeLocalAppOutcome>,
  validateEvent: (value: unknown) => NimiElectronLocalAppRecord,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event'])) throw untrustedRuntimeError();
  return Object.freeze({ completed: false, event: validateEvent(value.event) });
}

function validateScenarioJob(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'jobId', 'scenarioType', 'status', 'progressPercent', 'progressCurrentStep',
    'progressTotalSteps', 'reasonCode', 'reasonDetail', 'artifacts', 'traceId',
    'createdAt', 'updatedAt', 'transcriptionText',
  ])) throw untrustedRuntimeError();
  const scenarioTypes = [
    'image-generate',
    'video-generate',
    'speech-synthesize',
    'speech-transcribe',
    'voice-create',
    'music-generate',
  ];
  const statuses = ['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'];
  if (!scenarioTypes.includes(String(value.scenarioType)) || !statuses.includes(String(value.status))) {
    throw untrustedRuntimeError();
  }
  const progressPercent = boundedInteger(value.progressPercent, 0, 100);
  const progressCurrentStep = boundedInteger(value.progressCurrentStep, 0, Number.MAX_SAFE_INTEGER);
  const progressTotalSteps = boundedInteger(value.progressTotalSteps, 0, Number.MAX_SAFE_INTEGER);
  if (progressCurrentStep > progressTotalSteps) throw untrustedRuntimeError();
  return Object.freeze({
    jobId: boundedExactText(value.jobId, 128, false),
    scenarioType: value.scenarioType,
    status: value.status,
    progressPercent,
    progressCurrentStep,
    progressTotalSteps,
    reasonCode: boundedExactText(value.reasonCode, 128, true),
    reasonDetail: boundedExactText(value.reasonDetail, 1024, true),
    artifacts: validateScenarioArtifacts(value.artifacts),
    traceId: boundedExactText(value.traceId, 512, true),
    createdAt: validateTimestamp(value.createdAt),
    updatedAt: validateTimestamp(value.updatedAt),
    transcriptionText: boundedUtf8Content(value.transcriptionText, 256 * 1024, true),
  }) as NimiElectronLocalAppRecord;
}

function validateScenarioArtifacts(value: unknown): readonly NimiElectronLocalAppRecord[] {
  if (!Array.isArray(value) || value.length > 16) throw untrustedRuntimeError();
  return Object.freeze(value.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, [
      'artifactId', 'mimeType', 'bytes', 'sizeBytes', 'sha256', 'durationMs',
      'width', 'height', 'sampleRateHz', 'channels',
    ])) throw untrustedRuntimeError();
    const bytes = validateByteArray(entry.bytes);
    const sizeBytes = boundedInteger(entry.sizeBytes, 0, Number.MAX_SAFE_INTEGER);
    if (bytes.length > 0 && sizeBytes !== bytes.length) throw untrustedRuntimeError();
    return Object.freeze({
      artifactId: boundedExactText(entry.artifactId, 128, false),
      mimeType: boundedMime(entry.mimeType),
      bytes,
      sizeBytes,
      sha256: boundedExactText(entry.sha256, 128, true),
      durationMs: boundedInteger(entry.durationMs, 0, Number.MAX_SAFE_INTEGER),
      width: boundedInteger(entry.width, 0, Number.MAX_SAFE_INTEGER),
      height: boundedInteger(entry.height, 0, Number.MAX_SAFE_INTEGER),
      sampleRateHz: boundedInteger(entry.sampleRateHz, 0, Number.MAX_SAFE_INTEGER),
      channels: boundedInteger(entry.channels, 0, Number.MAX_SAFE_INTEGER),
    }) as NimiElectronLocalAppRecord;
  }));
}

function validateVoiceAsset(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'voiceAssetId', 'creationSource', 'status', 'createdAt', 'updatedAt', 'expiresAt',
  ]) || (value.creationSource !== 'reference-audio' && value.creationSource !== 'text-description')
    || !['active', 'expired', 'deleted', 'failed'].includes(String(value.status))) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    voiceAssetId: boundedExactText(value.voiceAssetId, 128, false),
    creationSource: value.creationSource,
    status: value.status,
    createdAt: validateTimestamp(value.createdAt),
    updatedAt: validateTimestamp(value.updatedAt),
    expiresAt: validateTimestamp(value.expiresAt),
  }) as NimiElectronLocalAppRecord;
}

function validateVoiceAssetReference(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['kind', 'voiceAssetId'])
    || value.kind !== 'voice_asset_id') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    kind: 'voice_asset_id',
    voiceAssetId: boundedExactText(value.voiceAssetId, 128, false),
  });
}

function validateScenarioJobEvent(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['eventType', 'sequence', 'traceId', 'timestamp', 'job'])
    || !['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'].includes(String(value.eventType))
    || typeof value.sequence !== 'string' || !/^[1-9][0-9]*$/u.test(value.sequence)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    eventType: value.eventType,
    sequence: value.sequence,
    traceId: boundedExactText(value.traceId, 512, true),
    timestamp: validateTimestamp(value.timestamp),
    job: validateScenarioJob(value.job),
  }) as NimiElectronLocalAppRecord;
}

function validateTextTurnEvent(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || typeof value.type !== 'string'
    || typeof value.sequence !== 'string' || !/^[1-9][0-9]*$/u.test(value.sequence)) {
    throw untrustedRuntimeError();
  }
  const traceId = boundedExactText(value.traceId, 512, false);
  if (value.type === 'delta') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'text'])) throw untrustedRuntimeError();
    return Object.freeze({ type: 'delta', sequence: value.sequence, traceId,
      text: boundedUtf8Content(value.text, 64 * 1024) });
  }
  if (value.type === 'completed') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'finishReason'])
      || !['stop', 'length', 'content-filter'].includes(String(value.finishReason))) throw untrustedRuntimeError();
    return Object.freeze({ type: 'completed', sequence: value.sequence, traceId, finishReason: String(value.finishReason) });
  }
  if (value.type === 'failed') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'reasonCode', 'actionHint'])) throw untrustedRuntimeError();
    return Object.freeze({ type: 'failed', sequence: value.sequence, traceId,
      reasonCode: boundedExactText(value.reasonCode, 128, false),
      actionHint: boundedExactText(value.actionHint, 512, true) });
  }
  throw untrustedRuntimeError();
}

function validateTimestamp(value: unknown): NimiElectronLocalAppRecord | null {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, ['seconds', 'nanos'])
    || typeof value.seconds !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(value.seconds)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ seconds: value.seconds, nanos: boundedInteger(value.nanos, 0, 999_999_999) });
}

function validateByteArray(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length > 32 * 1024 * 1024
    || value.some((entry) => !Number.isInteger(entry) || Number(entry) < 0 || Number(entry) > 255)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze([...value] as number[]);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw untrustedRuntimeError();
  }
  return value;
}

function boundedExactText(value: unknown, maximumBytes: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw untrustedRuntimeError();
  }
  return value;
}

function boundedUtf8Content(value: unknown, maximumBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || Buffer.byteLength(value, 'utf8') > maximumBytes || value.includes('\0')) {
    throw untrustedRuntimeError();
  }
  return value;
}

function boundedMime(value: unknown): string {
  const mime = boundedExactText(value, 128, false);
  if (!mime.includes('/')) throw untrustedRuntimeError();
  return mime;
}

function boundedImageMime(value: unknown): string {
  const mime = boundedMime(value);
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
    throw untrustedRuntimeError();
  }
  return mime;
}

async function invokeModelConfigLocalSelections(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value) || value.length > 64) throw untrustedRuntimeError();
  return Object.freeze(value.map((entry) => {
    if (!isPlainRecord(entry)
      || !hasExactKeys(entry, [
        'capabilityContract', 'state', 'loadoutId', 'displayName',
        'supportedFeatures', 'reasons', 'effectiveDefaults',
      ])
      || typeof entry.capabilityContract !== 'string'
      || !entry.capabilityContract
      || entry.capabilityContract.trim() !== entry.capabilityContract
      || (entry.state !== 'selected' && entry.state !== 'broken')
      || entry.loadoutId !== null
      || (entry.displayName !== null && (
        typeof entry.displayName !== 'string'
        || !entry.displayName
        || entry.displayName.trim() !== entry.displayName
        || Buffer.byteLength(entry.displayName, 'utf8') > 256
      ))
      || !Array.isArray(entry.supportedFeatures)
      || entry.supportedFeatures.some((feature) => typeof feature !== 'string'
        || !feature || feature.trim() !== feature)
      || !Array.isArray(entry.reasons)
      || entry.reasons.some((reason) => typeof reason !== 'string'
        || !reason || reason.trim() !== reason)) {
      throw untrustedRuntimeError();
    }
    return Object.freeze({
      capabilityContract: entry.capabilityContract,
      state: entry.state,
      loadoutId: null,
      displayName: entry.displayName,
      supportedFeatures: Object.freeze([...entry.supportedFeatures]),
      reasons: Object.freeze([...entry.reasons]),
      effectiveDefaults: boundedEffectiveDefaults(entry.effectiveDefaults),
    }) as NimiElectronLocalAppRecord;
  }));
}

function boundedEffectiveDefaults(value: unknown): Readonly<Record<string, string>> | null {
  if (value === null) return null;
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 64 || entries.some(([key, item]) => (
    !key || key.trim() !== key || Buffer.byteLength(key, 'utf8') > 128
    || typeof item !== 'string' || !item || item.trim() !== item
    || Buffer.byteLength(item, 'utf8') > 128
  ))) {
    throw untrustedRuntimeError();
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

async function invokeWorldCoreList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value)) throw untrustedRuntimeError();
  return Object.freeze(value.map((entry) => validateWorldCore(entry)));
}

async function invokeAgentReferenceList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value)) throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
  return Object.freeze(value.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ['agentHandle', 'displayName', 'avatarUrl'])) {
      throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
    }
    validateProjectionValue(entry);
    if (typeof entry.agentHandle !== 'string'
      || !/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(entry.agentHandle)
      || typeof entry.displayName !== 'string'
      || !entry.displayName
      || entry.displayName.trim() !== entry.displayName
      || Buffer.byteLength(entry.displayName, 'utf8') > 256
      || (entry.avatarUrl !== null && !safeAgentAvatarUrl(entry.avatarUrl))) {
      throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
    }
    return Object.freeze({
      agentHandle: entry.agentHandle,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl as string | null,
    }) as NimiElectronLocalAppRecord;
  }));
}

async function invokeWorldCore(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  return validateWorldCore(await invoke(call));
}

function validateWorldCore(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateJsonValue(value);
  validateProjectionValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

async function invokePersonaCharacterList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value) || value.length > 500) throw untrustedRuntimeError();
  return Object.freeze(value.map(validatePersonaCharacter));
}

async function invokePersonaCharacter(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  return validatePersonaCharacter(await invoke(call));
}

function validatePersonaCharacter(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateJsonValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

function validatePersonaCharacterWriteInput(value: unknown, replace: boolean): void {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  const keys = replace
    ? ['personaCharacterId', 'baseContentHash', 'worldId', 'visibility', 'origin', 'profile']
    : ['worldId', 'visibility', 'origin', 'profile'];
  if (!hasExactKeys(value, keys)) throw untrustedRuntimeError();
  exactText(value.worldId);
  if (!isPersonaWritableVisibility(value.visibility) || !isPlainRecord(value.origin) || !isPlainRecord(value.profile)) {
    throw untrustedRuntimeError();
  }
  if (Object.hasOwn(value.profile, 'profileHash') || Object.hasOwn(value.profile, 'profileCoverage')) {
    throw untrustedRuntimeError();
  }
  if (replace && (typeof value.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.baseContentHash))) {
    throw untrustedRuntimeError();
  }
  if (replace) exactText(value.personaCharacterId);
  validateJsonValue(value);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PERSONA_REQUEST_BYTES) {
    throw new NimiElectronLocalAppHostError('request-too-large', false);
  }
}

function validatePersonaCharacterListInput(value: NimiElectronLocalAppRecord): void {
  if (Object.keys(value).some((key) => !['worldId', 'visibility', 'afterId', 'take'].includes(key))) {
    throw untrustedRuntimeError();
  }
  if (value.worldId !== undefined) exactText(value.worldId);
  if (value.afterId !== undefined) exactText(value.afterId);
  if (value.visibility !== undefined && !isPersonaWritableVisibility(value.visibility)) throw untrustedRuntimeError();
  if (value.take !== undefined && (typeof value.take !== 'number' || !Number.isSafeInteger(value.take) || value.take < 1 || value.take > 500)) {
    throw untrustedRuntimeError();
  }
}

function isPersonaWritableVisibility(value: unknown): value is 'private' | 'unlisted' | 'public' {
  return value === 'private' || value === 'unlisted' || value === 'public';
}

async function invokeStorageDocument(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['sizeBytes', 'value'])) {
    throw untrustedRuntimeError();
  }
  const sizeBytes = Number(value.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 256 * 1024) {
    throw untrustedRuntimeError();
  }
  validateJsonValue(value.value);
  return Object.freeze({ value: value.value as NimiElectronLocalAppJson, sizeBytes });
}

async function invokeStorageRemove(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(['removed']) || typeof value.removed !== 'boolean') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ removed: value.removed });
}

async function invokeAssetRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return validateAssetRecord(await invoke(call));
}

async function invokeAssetList(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['assets', 'nextCursor'])
    || !Array.isArray(value.assets) || value.assets.length > 500
    || typeof value.nextCursor !== 'string' || value.nextCursor.length > 4096) throw untrustedRuntimeError();
  const assets = Object.freeze(value.assets.map(validateAssetRecord));
  for (let index = 1; index < assets.length; index += 1) {
    if (String(assets[index - 1]!.relativePath) >= String(assets[index]!.relativePath)) throw untrustedRuntimeError();
  }
  return Object.freeze({ assets, nextCursor: value.nextCursor }) as NimiElectronLocalAppRecord;
}

async function invokeAssetReadOpen(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['streamId', 'asset', 'range']) || !isPlainRecord(value.range)) {
    throw untrustedRuntimeError();
  }
  const asset = validateAssetRecord(value.asset);
  if (!hasExactKeys(value.range, ['offset', 'length', 'totalSize'])) throw untrustedRuntimeError();
  const offset = boundedInteger(value.range.offset, 0, Number.MAX_SAFE_INTEGER);
  const length = boundedInteger(value.range.length, 0, Number.MAX_SAFE_INTEGER);
  const totalSize = boundedInteger(value.range.totalSize, 0, Number.MAX_SAFE_INTEGER);
  if (totalSize !== asset.sizeBytes || offset > totalSize || length > totalSize - offset) throw untrustedRuntimeError();
  return Object.freeze({ streamId: exactText(value.streamId), asset, range: Object.freeze({ offset, length, totalSize }) }) as NimiElectronLocalAppRecord;
}

async function invokeAssetReadNext(call: () => Promise<NativeLocalAppBytesOutcome>): Promise<NimiElectronLocalAppAssetReadNext> {
  let outcome: NativeLocalAppBytesOutcome;
  try { outcome = await call(); } catch { throw untrustedRuntimeError(); }
  if (outcome.status === 'error') {
    const reasonCode = typeof outcome.reasonCode === 'string' ? outcome.reasonCode : '';
    if (!ADMITTED_REASON_CODES.has(reasonCode) || typeof outcome.retryable !== 'boolean') throw untrustedRuntimeError();
    throw new NimiElectronLocalAppHostError(reasonCode, outcome.retryable, validateReasonMetadata(outcome.reasonMetadata));
  }
  if (outcome.status !== 'ok' || typeof outcome.completed !== 'boolean') throw untrustedRuntimeError();
  if (outcome.completed) {
    if (outcome.value !== null && outcome.value !== undefined) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!(outcome.value instanceof Uint8Array) || outcome.value.byteLength === 0 || outcome.value.byteLength > 1024 * 1024) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ completed: false, bodyChunk: new Uint8Array(outcome.value) });
}

async function invokeExactBooleanRecord(
  call: () => Promise<NativeLocalAppOutcome>,
  key: string,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, [key]) || typeof value[key] !== 'boolean') throw untrustedRuntimeError();
  return Object.freeze({ [key]: value[key] }) as NimiElectronLocalAppRecord;
}

function validateAssetRecord(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'relativePath', 'mediaType', 'sizeBytes', 'sha256', 'createdAt', 'updatedAt',
  ])) throw untrustedRuntimeError();
  const relativePath = boundedExactText(value.relativePath, 240, false);
  if (relativePath.startsWith('/') || relativePath.endsWith('/') || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) throw untrustedRuntimeError();
  const mediaType = value.mediaType === null ? null : boundedMime(value.mediaType);
  const sizeBytes = boundedInteger(value.sizeBytes, 0, Number.MAX_SAFE_INTEGER);
  if (typeof value.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)) throw untrustedRuntimeError();
  const createdAt = boundedExactText(value.createdAt, 64, false);
  const updatedAt = boundedExactText(value.updatedAt, 64, false);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw untrustedRuntimeError();
  return Object.freeze({ relativePath, mediaType, sizeBytes, sha256: value.sha256, createdAt, updatedAt });
}

async function invokeConversationOpen(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['conversationAnchorId', 'activeTurnId'])) {
    throw untrustedRuntimeError();
  }
  const conversationAnchorId = exactText(value.conversationAnchorId);
  const activeTurnId = optionalExactText(value.activeTurnId);
  return Object.freeze({ conversationAnchorId, activeTurnId });
}

async function invokeExactTextRecord(
  call: () => Promise<NativeLocalAppOutcome>,
  keys: readonly string[],
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) throw untrustedRuntimeError();
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, exactText(value[key])]))) as NimiElectronLocalAppRecord;
}

async function invokeConversationStreamNext(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event']) || !isPlainRecord(value.event)) throw untrustedRuntimeError();
  const event = validateConversationEvent(value.event);
  return Object.freeze({ completed: false, event });
}

async function invokeConversationStreamClose(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['closed']) || typeof value.closed !== 'boolean') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ closed: value.closed });
}

function validateConversationEvent(value: Record<string, unknown>): NimiElectronLocalAppRecord {
  if (typeof value.sequence !== 'string'
    || !/^[1-9][0-9]*$/u.test(value.sequence)
    || typeof value.type !== 'string') {
    throw untrustedRuntimeError();
  }
  exactText(value.conversationAnchorId);
  exactText(value.turnId);
  const common = ['type', 'conversationAnchorId', 'sequence', 'turnId'];
  switch (value.type) {
    case 'turn-accepted':
      if (!hasExactKeys(value, [...common, 'requestId'])) throw untrustedRuntimeError();
      exactText(value.requestId);
      break;
    case 'turn-started':
      if (!hasExactKeys(value, common)) throw untrustedRuntimeError();
      break;
    case 'text-delta':
      if (!hasExactKeys(value, [...common, 'text'])) throw untrustedRuntimeError();
      exactText(value.text);
      break;
    case 'message-committed':
      if (!hasExactKeys(value, [...common, 'messageId', 'text'])) throw untrustedRuntimeError();
      exactText(value.messageId);
      exactText(value.text);
      break;
    case 'turn-completed':
      if (!hasExactKeys(value, [...common, 'terminalReason'])
        || typeof value.terminalReason !== 'string'
        || !['', 'stop', 'length', 'tool_call', 'content_filter', 'error', 'unspecified'].includes(value.terminalReason)) {
        throw untrustedRuntimeError();
      }
      break;
    case 'turn-failed':
      if (!hasExactKeys(value, [...common, 'reasonCode', 'message'])
        || typeof value.reasonCode !== 'string'
        || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)
        || (value.message !== null && typeof value.message !== 'string')) {
        throw untrustedRuntimeError();
      }
      if (typeof value.message === 'string') exactText(value.message);
      break;
    case 'turn-interrupted':
      if (!hasExactKeys(value, [...common, 'reason'])
        || typeof value.reason !== 'string'
        || !['user_cancel', 'room_closed', 'superseded_turn', 'budget_exhausted', 'timeout', 'gateway_revoked', 'policy_refusal'].includes(value.reason)) {
        throw untrustedRuntimeError();
      }
      break;
    default:
      throw untrustedRuntimeError();
  }
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

async function invokeConversationSnapshot(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['conversationAnchorId', 'activeTurnId', 'messages', 'truncatedBefore'])
    || !Array.isArray(value.messages)
    || value.messages.length > 200
    || typeof value.truncatedBefore !== 'boolean') {
    throw untrustedRuntimeError();
  }
  const conversationAnchorId = exactText(value.conversationAnchorId);
  const activeTurnId = optionalExactText(value.activeTurnId);
  let textBytes = 0;
  const messages = value.messages.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ['turnId', 'role', 'text'])
      || (entry.role !== 'user' && entry.role !== 'assistant')) {
      throw untrustedRuntimeError();
    }
    const turnId = exactText(entry.turnId);
    const text = exactText(entry.text);
    textBytes += new TextEncoder().encode(text).byteLength;
    if (textBytes > 1024 * 1024) throw untrustedRuntimeError();
    return Object.freeze({ turnId, role: entry.role, text }) as NimiElectronLocalAppRecord;
  });
  return Object.freeze({
    conversationAnchorId,
    activeTurnId,
    messages: Object.freeze(messages),
    truncatedBefore: value.truncatedBefore,
  });
}

function validateReasonMetadata(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isPlainRecord(value) || Object.keys(value).length > ADMITTED_REASON_METADATA_KEYS.size) {
    throw untrustedRuntimeError();
  }
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ADMITTED_REASON_METADATA_KEYS.has(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw untrustedRuntimeError();
    }
    metadata[key] = entry;
  }
  return Object.freeze(metadata);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safeAgentAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && (parsed.port === '' || parsed.port === '443')
      && parsed.hostname !== 'localhost'
      && !parsed.hostname.endsWith('.localhost')
      && !parsed.hostname.endsWith('.local')
      && !parsed.hostname.endsWith('.internal')
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(parsed.hostname)
      && !parsed.hostname.includes(':');
  } catch {
    return false;
  }
}

function exactText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512) throw untrustedRuntimeError();
  return value;
}

function optionalExactText(value: unknown): string | null {
  if (value === null) return null;
  return exactText(value);
}

function validateJsonValue(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 100_000) throw untrustedRuntimeError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateJsonValue(entry, depth + 1, budget);
    return;
  }
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  for (const entry of Object.values(value)) validateJsonValue(entry, depth + 1, budget);
}

function validateProjection(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateProjectionValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

function validateProjectionValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateProjectionValue(entry);
    return;
  }
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(key)) throw untrustedRuntimeError();
    validateProjectionValue(entry);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function untrustedRuntimeError(): NimiElectronLocalAppHostError {
  return new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
}
