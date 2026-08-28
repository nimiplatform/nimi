import { CoreClient } from '../core-client/index.js';
import {
  RealmTypedClient,
  type RealmTypedCallOptions,
  type RealmWorldCoreControllerListPersonaCharactersOperationRequest,
  type RealmWorldCoreControllerListPersonaCharactersOperationResponse,
} from '../core-generated/realm-typed-client.js';
import { RuntimeHealthStatus } from '../core-generated/runtime-protobuf/runtime/v1/audit.js';
import {
  RuntimeTypedClient,
  type AccountSessionEvent,
  type AccountSessionSnapshot,
  type GetRuntimeHealthResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client.js';
import { createRuntimeAccountMediatedBundledAvatarRealmTransport } from '../core/app/runtime-account-realm.js';
import {
  createNimiLocalAppAgentReferencesRuntimeClient,
  createNimiLocalAppConversationRuntimeClient,
  type NimiLocalAppAgentReferencesClient,
  type NimiLocalAppConversationClient,
} from '../core/app/local-app-runtime-platform.js';
import {
  createNimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureClient,
} from '../core/app/local-app-runtime-platform-configure.js';
import { createNimiError, ReasonCode } from '../types/index.js';
import { createNimiAvatarNativeHostRuntimeAccountCaller } from './account-caller.js';
import { createNimiRuntimeLocalAppAgentConfigureShell } from './runtime-local-app-agent-configure.js';
import {
  NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS,
  type NimiBundledAvatarTypedMethodName,
} from './bundled-avatar-profile.generated.js';
import { createRuntimeElectronIpcTransport } from './electron-ipc.js';
import { createRuntimeTauriIpcTransport } from './tauri-ipc.js';

type BundledAvatarMethodGroup<
  Names extends readonly NimiBundledAvatarTypedMethodName[],
> = Pick<RuntimeTypedClient, Names[number]>;

export type NimiBundledAvatarRuntimeClient = {
  readonly localAgentReferences: NimiLocalAppAgentReferencesClient;
  readonly conversation: NimiLocalAppConversationClient;
  readonly agentConfigure: NimiLocalAppAgentConfigureClient;
  readonly session: {
    readonly getSnapshot: (options?: RuntimeTypedCallOptions) => Promise<AccountSessionSnapshot>;
    readonly subscribe: (
      afterSequence?: string,
      options?: RuntimeTypedCallOptions,
    ) => AsyncIterable<AccountSessionEvent>;
  };
  readonly realm: {
    readonly listPersonaCharacters: (
      request?: RealmWorldCoreControllerListPersonaCharactersOperationRequest,
      options?: RealmTypedCallOptions,
    ) => Promise<RealmWorldCoreControllerListPersonaCharactersOperationResponse>;
  };
  readonly ready: (options?: RuntimeTypedCallOptions) => Promise<GetRuntimeHealthResponse>;
};

/**
 * Creates the only SDK Runtime surface admitted for the bundled Avatar.
 * The renderer supplies no endpoint, app identity, metadata, method profile,
 * account identity, or bearer material. The verified Desktop host derives all
 * of those inputs from the fixed protected carrier profile.
 */
export function createNimiBundledAvatarRuntimeClient(): NimiBundledAvatarRuntimeClient {
  const nativeTransport = hasBundledAvatarElectronBridge()
    ? createRuntimeElectronIpcTransport()
    : createRuntimeTauriIpcTransport();
  const generated = new RuntimeTypedClient(new CoreClient({
    transport: nativeTransport,
  }));
  const audit = bindFixedMethodGroup(generated, NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.audit);
  const accountCaller = createNimiAvatarNativeHostRuntimeAccountCaller();
  const account = bindFixedMethodGroup(generated, NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.account);
  const agents = bindFixedMethodGroup(generated, NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.agents);
  const localAgentReferences = createNimiLocalAppAgentReferencesRuntimeClient(agents);
  const conversation = createNimiLocalAppConversationRuntimeClient(agents);
  const agentConfigure = createNimiLocalAppAgentConfigureClient(
    createNimiRuntimeLocalAppAgentConfigureShell(agents),
  );
  const realm = new RealmTypedClient(new CoreClient({
    transport: createRuntimeAccountMediatedBundledAvatarRealmTransport({
      runtime: { account },
      accountCaller,
    }),
  }));
  return Object.freeze({
    localAgentReferences,
    conversation,
    agentConfigure,
    session: Object.freeze({
      getSnapshot: async (options: RuntimeTypedCallOptions = {}) => {
        const response = await account.getAccountSessionStatus({ caller: accountCaller }, options);
        if (!response.accepted || !response.snapshot) {
          throw createNimiError({
            message: 'Bundled Avatar account snapshot is unavailable.',
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'repair_runtime_account_session',
            source: 'runtime',
          });
        }
        return response.snapshot;
      },
      subscribe: (
        afterSequence = '0',
        options: RuntimeTypedCallOptions = {},
      ) => account.subscribeAccountSessionEvents({
        caller: accountCaller,
        afterSequence: normalizeSequence(afterSequence),
      }, options),
    }),
    realm: Object.freeze({
      listPersonaCharacters: (
        request: RealmWorldCoreControllerListPersonaCharactersOperationRequest = {
          path: {},
          query: { scope: 'owned' },
        },
        options: RealmTypedCallOptions = {},
      ) => realm.worldCoreControllerListPersonaCharacters(request, options),
    }),
    ready: async (options: RuntimeTypedCallOptions = {}) => {
      const health = await audit.getRuntimeHealth({}, options);
      if (health.status !== RuntimeHealthStatus.READY) {
        throw createNimiError({
          message: 'Bundled Avatar Runtime is not ready.',
          reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'restart_desktop_supervised_avatar_session',
          source: 'runtime',
        });
      }
      return health;
    },
  });
}

function hasBundledAvatarElectronBridge(): boolean {
  const root = globalThis as typeof globalThis & {
    readonly __NIMI_ELECTRON_RUNTIME__?: { readonly invoke?: unknown };
    readonly __NIMI_ELECTRON_TEST__?: { readonly invoke?: unknown };
    readonly window?: {
      readonly __NIMI_ELECTRON_RUNTIME__?: { readonly invoke?: unknown };
      readonly __NIMI_ELECTRON_TEST__?: { readonly invoke?: unknown };
    };
  };
  return Boolean(
    typeof root.__NIMI_ELECTRON_RUNTIME__?.invoke === 'function'
      || typeof root.__NIMI_ELECTRON_TEST__?.invoke === 'function'
      || typeof root.window?.__NIMI_ELECTRON_RUNTIME__?.invoke === 'function'
      || typeof root.window?.__NIMI_ELECTRON_TEST__?.invoke === 'function',
  );
}

function normalizeSequence(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw createNimiError({
      message: 'Bundled Avatar account stream sequence is invalid.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_SEQUENCE_INVALID',
      actionHint: 'use_the_last_runtime_account_sequence',
      source: 'sdk',
    });
  }
  return normalized;
}

function bindFixedMethodGroup<Names extends readonly NimiBundledAvatarTypedMethodName[]>(
  client: RuntimeTypedClient,
  methodNames: Names,
): BundledAvatarMethodGroup<Names> {
  const methods: Partial<Record<NimiBundledAvatarTypedMethodName, unknown>> = {};
  for (const methodName of methodNames) {
    const method = client[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Bundled Avatar generated Runtime method is missing: ${methodName}`);
    }
    methods[methodName] = method.bind(client);
  }
  return Object.freeze(methods) as BundledAvatarMethodGroup<Names>;
}
