import type { EventBus } from '../internal/event-bus.js';
import type { JsonObject } from '../internal/utils.js';
import type { ScopeModule } from '../scope/index.js';
import { FallbackPolicy } from './generated/runtime/v1/ai.js';
import type {
  RuntimeAppAuthClient,
  RuntimeAccountClient,
  RuntimeAgentModule,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeCallOptions,
  RuntimeClient,
  RuntimeConnectorClient,
  RuntimeEventPayloadMap,
  RuntimeEventsModule,
  RuntimeExternalAgentClient,
  RuntimeKnowledgeClient,
  RuntimeLocalServiceClient,
  RuntimeMediaModule,
  RuntimeMemoryClient,
  RuntimeModelClient,
  RuntimeOptions,
  RuntimeScopeModule,
  RuntimeStreamCallOptions,
  RuntimeTransportConfig,
  RuntimeUnsafeRawModule,
  RuntimeWorkflowClient,
} from './types.js';
import type { RuntimeAiModule } from './types.js';
import type { RuntimeInternalContext } from './internal-context.js';
import {
  attachRuntimeAgentSurface,
  createRuntimeAgentAnchorsModule,
  createRuntimeAgentTurnsModule,
} from './runtime-agent-surface.js';
import {
  createRuntimeAvatarDebugModule,
  type RuntimeAvatarDebugModule,
} from './runtime-avatar-debug.js';
import {
  createRuntimeCompanionParticipationModule,
  type RuntimeCompanionParticipationModule,
} from './runtime-companion-participation.js';
import {
  type RuntimeArtifactsModule,
  createRuntimeArtifactsModule,
} from './runtime-artifacts.js';
import {
  type RuntimeAppLifecycleModule,
  createRuntimeAppLifecycleModule,
} from './runtime-app-lifecycle.js';
import {
  createRuntimeProtectedScopeHelper,
  type RuntimeProtectedScopeHelper,
} from './protected-access.js';
import {
  resolveRuntimeCallOptions,
  resolveRuntimeStreamOptions,
} from './runtime-infra.js';
import {
  runtimeAiRequestRequiresSubject,
  resolveOptionalRuntimeSubjectUserId,
  resolveRuntimeSubjectUserId,
} from './runtime-guards.js';
import {
  createCorePassthroughClients,
  createHealthEventStreams,
  createAiModule,
  createAppAuthClient,
  createAppClient,
  createMediaModule,
  createRuntimeEventsModule,
  createScopeClient,
  emitAuthTokenIssuedEvent,
  emitAuthTokenRevokedEvent,
} from './runtime-modules.js';
import { createRuntimeUnsafeRawModule } from './runtime-unsafe-raw.js';

type RuntimeSurfaceWiringInput = {
  appId: string;
  options: RuntimeOptions;
  transport: RuntimeTransportConfig;
  scopeModule: ScopeModule;
  eventBus: EventBus<RuntimeEventPayloadMap>;
  invoke: <T>(operation: () => Promise<T>) => Promise<T>;
  invokeWithClient: <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;
  assertMethodAvailable: (moduleKey: string, methodKey: string) => void;
  wrapModeDStream: <T>(source: AsyncIterable<T>) => AsyncIterable<T>;
  emitTelemetry: (name: string, data?: JsonObject) => void;
};

export type RuntimeSurfaceWiring = {
  ctx: RuntimeInternalContext;
  events: RuntimeEventsModule;
  auth: RuntimeAuthClient;
  externalAgent: RuntimeExternalAgentClient;
  appAuth: RuntimeAppAuthClient;
  account: RuntimeAccountClient;
  ai: RuntimeAiModule;
  artifacts: RuntimeArtifactsModule;
  media: RuntimeMediaModule;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  memory: RuntimeMemoryClient;
  agent: RuntimeAgentModule;
  avatarDebug: RuntimeAvatarDebugModule;
  companionParticipation: RuntimeCompanionParticipationModule;
  app: {
    sendMessage: RuntimeClient['app']['sendAppMessage'];
    subscribeMessages: RuntimeClient['app']['subscribeAppMessages'];
  };
  appLifecycle: RuntimeAppLifecycleModule;
  audit: RuntimeAuditClient;
  healthEvents: (
    request?: import('./generated/runtime/v1/audit').SubscribeRuntimeHealthEventsRequest,
    options?: RuntimeStreamCallOptions,
  ) => Promise<AsyncIterable<import('./generated/runtime/v1/audit').RuntimeHealthEvent>>;
  providerHealthEvents: (
    request?: import('./generated/runtime/v1/audit').SubscribeAIProviderHealthEventsRequest,
    options?: RuntimeStreamCallOptions,
  ) => Promise<AsyncIterable<import('./generated/runtime/v1/audit').AIProviderHealthEvent>>;
  scope: RuntimeScopeModule;
  unsafeRaw: RuntimeUnsafeRawModule;
};

export function createRuntimeSurfaceWiring(input: RuntimeSurfaceWiringInput): RuntimeSurfaceWiring {
  let protectedScopeHelper: RuntimeProtectedScopeHelper | null = null;

  const ctx: RuntimeInternalContext = {
    appId: input.appId,
    options: input.options,
    invoke: input.invoke,
    invokeWithClient: input.invokeWithClient,
    resolveRuntimeCallOptions: (callOptions) => resolveRuntimeCallOptions(input.options, callOptions),
    resolveRuntimeStreamOptions: (streamOptions) => resolveRuntimeStreamOptions(input.options, streamOptions),
    resolveSubjectUserId: (explicit) => resolveRuntimeSubjectUserId({
      explicit,
      subjectContext: input.options.subjectContext,
    }),
    resolveOptionalSubjectUserId: (explicit) => resolveOptionalRuntimeSubjectUserId({
      explicit,
      subjectContext: input.options.subjectContext,
    }),
    normalizeScenarioHead: async ({ head, metadata }) => {
      const subjectUserId = runtimeAiRequestRequiresSubject({
        request: { head },
        metadata,
      })
        ? await resolveRuntimeSubjectUserId({
          explicit: head.subjectUserId,
          subjectContext: input.options.subjectContext,
        })
        : await resolveOptionalRuntimeSubjectUserId({
          explicit: head.subjectUserId,
          subjectContext: input.options.subjectContext,
        });
      return {
        ...head,
        subjectUserId: subjectUserId || '',
        fallback: head.fallback ?? FallbackPolicy.DENY,
      };
    },
    resolveProtectedCallOptions: async <
      T extends RuntimeCallOptions | RuntimeStreamCallOptions,
    >(scopes: readonly string[], baseOptions?: T, subjectUserId?: string): Promise<T> => {
      if (!protectedScopeHelper || !input.options.protectedAccess?.autoIssueForAi) {
        return { ...(baseOptions || {}) } as T;
      }
      return protectedScopeHelper.getCallOptions(scopes, baseOptions, subjectUserId);
    },
    emitTelemetry: input.emitTelemetry,
  };

  const events = createRuntimeEventsModule(input.eventBus);

  const passthrough = createCorePassthroughClients({
    assertMethodAvailable: input.assertMethodAvailable,
    invokeWithClient: input.invokeWithClient,
  });

  const healthStreams = createHealthEventStreams({
    audit: passthrough.audit,
    wrapModeDStream: input.wrapModeDStream,
  });

  const app = createAppClient({
    invokeWithClient: input.invokeWithClient,
    wrapModeDStream: input.wrapModeDStream,
  });

  const appAuth = createAppAuthClient({
    invokeWithClient: input.invokeWithClient,
    resolvePublishedCatalogVersion: (requested) => input.scopeModule.resolvePublishedCatalogVersion(requested),
    emitTelemetry: input.emitTelemetry,
    authEvents: {
      emitTokenIssued: (tokenId) => emitAuthTokenIssuedEvent(input.eventBus, tokenId),
      emitTokenRevoked: (tokenId) => emitAuthTokenRevokedEvent(input.eventBus, tokenId),
    },
  });

  protectedScopeHelper = createRuntimeProtectedScopeHelper({
    runtime: {
      appId: input.appId,
      transport: input.transport,
      developerRegistration: input.options.protectedAccess?.developerRegistration === true,
      auth: passthrough.auth,
      appAuth,
    },
    getSubjectUserId: (explicit) => ctx.resolveSubjectUserId(explicit),
  });

  const agent = attachRuntimeAgentSurface(passthrough.agent, {
    anchors: createRuntimeAgentAnchorsModule({
      appId: input.appId,
      agent: passthrough.agent,
      protectedAccess: protectedScopeHelper,
      resolveSubjectUserId: (explicit) => ctx.resolveSubjectUserId(explicit),
    }),
    turns: createRuntimeAgentTurnsModule({
      appId: input.appId,
      agent: passthrough.agent,
      app,
      protectedAccess: protectedScopeHelper,
      resolveSubjectUserId: (explicit) => ctx.resolveSubjectUserId(explicit),
    }),
  });

  const avatarDebug = createRuntimeAvatarDebugModule({
    appId: input.appId,
    agent: passthrough.agent,
    protectedAccess: protectedScopeHelper,
    resolveSubjectUserId: (explicit) => ctx.resolveSubjectUserId(explicit),
  });

  const companionParticipation = createRuntimeCompanionParticipationModule({
    appId: input.appId,
    agent: passthrough.agent,
    protectedAccess: protectedScopeHelper,
    resolveSubjectUserId: (explicit) => ctx.resolveSubjectUserId(explicit),
  });

  const scope = createScopeClient({
    invoke: input.invoke,
    scopeModule: input.scopeModule,
  });

  const ai = createAiModule({
    invokeWithClient: input.invokeWithClient,
    ctx,
  });

  const artifacts = createRuntimeArtifactsModule({ ctx });
  const appLifecycle = createRuntimeAppLifecycleModule({ ctx });
  const media = createMediaModule(ctx);

  const unsafeRaw = createRuntimeUnsafeRawModule({
    assertMethodAvailable: input.assertMethodAvailable,
    invokeWithClient: input.invokeWithClient,
  });

  return {
    ctx,
    events,
    auth: passthrough.auth,
    externalAgent: passthrough.externalAgent,
    appAuth,
    account: passthrough.account,
    ai,
    artifacts,
    media,
    workflow: passthrough.workflow,
    model: passthrough.model,
    local: passthrough.local,
    connector: passthrough.connector,
    knowledge: passthrough.knowledge,
    memory: passthrough.memory,
    agent,
    avatarDebug,
    companionParticipation,
    app,
    appLifecycle,
    audit: passthrough.audit,
    healthEvents: healthStreams.healthEvents,
    providerHealthEvents: healthStreams.providerHealthEvents,
    scope,
    unsafeRaw,
  };
}
