import { CoreClient } from '../core-client/index.js';
import {
  RealmTypedClient,
  type RealmTypedCallOptions,
  type RealmWorldCoreControllerListPersonaCharactersOperationRequest,
  type RealmWorldCoreControllerListPersonaCharactersOperationResponse,
} from '../core-generated/realm-typed-client.js';
import { RuntimeHealthStatus } from '../core-generated/runtime-protobuf/runtime/v1/audit.js';
import {
  AgentLifecycleStatus,
  RuntimeTypedClient,
  type AccountSessionEvent,
  type AccountSessionSnapshot,
  type AgentRecord,
  type GetRuntimeHealthResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client.js';
import { createRuntimeAccountMediatedBundledAvatarRealmTransport } from '../core/app/runtime-account-realm.js';
import { createNimiError, ReasonCode } from '../types/index.js';
import { createNimiAvatarNativeHostRuntimeAccountCaller } from './account-caller.js';
import type { NimiRuntimeAgentScopeRunner } from './runtime-agent-protected.js';
import {
  NIMI_BUNDLED_AVATAR_APP_ID,
  NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS,
  type NimiBundledAvatarTypedMethodName,
} from './bundled-avatar-profile.generated.js';
import { createRuntimeElectronIpcTransport } from './electron-ipc.js';
import { createRuntimeTauriIpcTransport } from './tauri-ipc.js';

type BundledAvatarMethodGroup<
  Names extends readonly NimiBundledAvatarTypedMethodName[],
> = Pick<RuntimeTypedClient, Names[number]>;

export type NimiBundledAvatarRuntimeClient = {
  readonly accountCaller: ReturnType<typeof createNimiAvatarNativeHostRuntimeAccountCaller>;
  readonly audit: BundledAvatarMethodGroup<typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.audit>;
  readonly account: BundledAvatarMethodGroup<typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.account>;
  readonly agents: BundledAvatarMethodGroup<typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.agents>;
  readonly artifacts: BundledAvatarMethodGroup<typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.artifacts>;
  readonly ai: BundledAvatarMethodGroup<typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.ai>;
  readonly appMessages: BundledAvatarMethodGroup<typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.appMessages>;
  readonly session: {
    readonly getSnapshot: (options?: RuntimeTypedCallOptions) => Promise<AccountSessionSnapshot>;
    readonly subscribe: (
      afterSequence?: string,
      options?: RuntimeTypedCallOptions,
    ) => AsyncIterable<AccountSessionEvent>;
  };
  readonly currentAgent: {
    readonly get: (agentId: string, options?: RuntimeTypedCallOptions) => Promise<AgentRecord>;
    readonly list: (options?: RuntimeTypedCallOptions) => Promise<readonly AgentRecord[]>;
  };
  readonly realm: {
    readonly listPersonaCharacters: (
      request?: RealmWorldCoreControllerListPersonaCharactersOperationRequest,
      options?: RealmTypedCallOptions,
    ) => Promise<RealmWorldCoreControllerListPersonaCharactersOperationResponse>;
  };
  /**
   * Fixed protected-carrier scope runner for Runtime Agent helpers. The
   * renderer cannot attach a grant, binding, identity, or arbitrary metadata;
   * the Desktop host and native carrier remain the authority for every call.
   */
  readonly withAgentScopes: NimiRuntimeAgentScopeRunner;
  readonly ready: (options?: RuntimeTypedCallOptions) => Promise<GetRuntimeHealthResponse>;
};

const BUNDLED_AVATAR_AGENT_SCOPES = new Set([
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.avatar_debug.read',
  'runtime.agent.avatar_debug.write',
]);

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
  const realm = new RealmTypedClient(new CoreClient({
    transport: createRuntimeAccountMediatedBundledAvatarRealmTransport({
      runtime: { account },
      accountCaller,
    }),
  }));
  return Object.freeze({
    accountCaller,
    audit,
    account,
    agents,
    artifacts: bindFixedMethodGroup(generated, NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.artifacts),
    ai: bindFixedMethodGroup(generated, NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.ai),
    appMessages: bindFixedMethodGroup(generated, NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS.appMessages),
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
    currentAgent: Object.freeze({
      get: async (agentId: string, options: RuntimeTypedCallOptions = {}) => {
        const normalizedAgentID = normalizeAgentID(agentId);
        const response = await agents.getAgent({
          context: bundledAvatarAgentSelector(),
          agentId: normalizedAgentID,
        }, options);
        return requireCurrentAgent(response.agent, normalizedAgentID);
      },
      list: async (options: RuntimeTypedCallOptions = {}) => {
        const response = await agents.listAgents({
          context: bundledAvatarAgentSelector(),
          lifecycleFilter: AgentLifecycleStatus.ACTIVE,
          pageSize: 200,
          pageToken: '',
        }, options);
        return Object.freeze(response.agents.map((agent) => requireCurrentAgent(agent, agent.agentId)));
      },
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
    withAgentScopes: async (scopes, operation) => {
      const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
      if (normalized.some((scope) => !BUNDLED_AVATAR_AGENT_SCOPES.has(scope))) {
        throw createNimiError({
          message: 'Bundled Avatar requested a Runtime Agent scope outside its fixed profile.',
          reasonCode: ReasonCode.APP_SCOPE_FORBIDDEN,
          actionHint: 'use_the_generated_bundled_avatar_runtime_surface',
          source: 'sdk',
        });
      }
      return operation({});
    },
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

function bundledAvatarAgentSelector() {
  return {
    appId: NIMI_BUNDLED_AVATAR_APP_ID,
    subjectUserId: '',
    ownerUserId: '',
    runtimeSourceRef: '',
    localAgentRef: '',
  };
}

function normalizeAgentID(value: unknown): string {
  const agentId = String(value ?? '').trim();
  if (!agentId.startsWith('local-agent:')) {
    throw createNimiError({
      message: 'Bundled Avatar launch requires a Runtime local Agent id.',
      reasonCode: 'SDK_RUNTIME_AGENT_ID_INVALID',
      actionHint: 'use_the_desktop_launch_agent_id',
      source: 'sdk',
    });
  }
  return agentId;
}

function requireCurrentAgent(agent: AgentRecord | undefined, expectedAgentID: string): AgentRecord {
  if (!agent
    || agent.agentId !== expectedAgentID
    || agent.localAgentRef !== expectedAgentID
    || !agent.ownerUserId.trim()
    || !agent.runtimeSourceRef.trim()) {
    throw createNimiError({
      message: 'Bundled Avatar Runtime Agent projection is invalid.',
      reasonCode: 'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      actionHint: 'inspect_runtime_agent_projection',
      source: 'runtime',
    });
  }
  return agent;
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
