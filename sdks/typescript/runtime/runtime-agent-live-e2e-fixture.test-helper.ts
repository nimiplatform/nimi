import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Realm } from '../realm';
import {
  createNimiRealmSourceMaterializationPacket,
} from '../realm/social';
import { Runtime } from './index';
import { withRuntimeDaemon } from './live-runtime-daemon.test-helper';
import { withRealmFixtureServer } from './runtime-agent-live-e2e-fixture-realm-server.test-helper';
import {
  createFixtureImageConnector,
  createFixtureRouteProjection,
  resolveFixtureImageConnectorModel,
  seedRuntimeAgentLiveLocalRouteState,
} from './runtime-agent-live-e2e-fixture-routes.test-helper';
import {
  admitDeveloperRegisteredRuntimeAccountCaller,
  admitLocalFirstPartyRuntimeAccountCaller,
  completeRuntimeAccountLogin,
  createFixtureRuntimeAgentClient,
  createRuntimeForEndpoint,
  createRuntimeMediatedRealmTransport,
  desktopAccountCaller,
  initializeFixtureLocalAgent,
  logoutRuntimeAccount,
  openFixtureConversation,
  realmWorldStudioCaller,
  registerRuntimeApp,
  requireConversationAnchorId,
  sendFixtureTurn,
} from './runtime-agent-live-e2e-fixture-runtime.test-helper';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  LOCAL_TEXT_MODEL_ID,
  OWNER_USER_ID,
  REALM_STUDIO_DEVICE_ID,
  REALM_WORLD_STUDIO_APP_ID,
  REALM_WORLD_STUDIO_APP_INSTANCE_ID,
  RUNTIME_SOURCE_REF,
  SOURCE_MATERIALIZATION_AUDIENCE,
  SOURCE_PACKET_HMAC_SECRET,
  SOURCE_REF,
  requireText,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';
import type {
  RuntimeAgentLiveE2EFixtureContext,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

export {
  SOURCE_MATERIALIZATION_AUDIENCE,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';
export type {
  RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
  RuntimeAgentLiveE2EFixtureContext,
  RuntimeAgentLiveE2ERealmRequest,
  RuntimeAgentLiveE2ERouteProjection,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLATFORM_APP_REGISTRY_PATH = resolve(
  REPO_ROOT,
  '.nimi',
  'spec',
  'platform',
  'kernel',
  'tables',
  'nimi-app-registry.yaml',
);

export async function withRuntimeAgentLiveE2EFixture(input: {
  readonly runtimeEnv?: Readonly<Record<string, string>>;
  readonly localChatCompletionStreamDelayMs?: number;
  readonly run: (context: RuntimeAgentLiveE2EFixtureContext) => Promise<void>;
}): Promise<void> {
  await withRealmFixtureServer({
    localChatCompletionStreamDelayMs: input.localChatCompletionStreamDelayMs,
    run: async ({ baseUrl, requests }) => {
    await withRuntimeDaemon({
      appId: DESKTOP_APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: baseUrl,
        NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${baseUrl}/api/auth/oauth/authorize`,
        NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${baseUrl}/api/auth/oauth/token`,
        NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `sdk-runtime-agent-live-e2e-${randomUUID()}`,
        NIMI_RUNTIME_APP_REGISTRY_PATH: PLATFORM_APP_REGISTRY_PATH,
        NIMI_RUNTIME_DEFAULT_LOCAL_TEXT_MODEL: LOCAL_TEXT_MODEL_ID,
        NIMI_RUNTIME_ENGINE_LLAMA_ENABLED: '0',
        NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: `${baseUrl}/v1`,
        NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT: '1',
        SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET: SOURCE_PACKET_HMAC_SECRET,
        ...(input.runtimeEnv || {}),
      },
      prepareState: ({ localStatePath }) => {
        seedRuntimeAgentLiveLocalRouteState(localStatePath, `${baseUrl}/v1`);
      },
      run: async ({ endpoint, localModelsPath }) => {
        const runtime = createRuntimeForEndpoint(endpoint, DESKTOP_APP_ID);
        const studioRuntime = createRuntimeForEndpoint(endpoint, REALM_WORLD_STUDIO_APP_ID);
        const desktopCaller = desktopAccountCaller();
        const studioCaller = realmWorldStudioCaller();

        await registerRuntimeApp(runtime, DESKTOP_APP_ID, DESKTOP_APP_INSTANCE_ID, DESKTOP_DEVICE_ID);
        await registerRuntimeApp(
          studioRuntime,
          REALM_WORLD_STUDIO_APP_ID,
          REALM_WORLD_STUDIO_APP_INSTANCE_ID,
          REALM_STUDIO_DEVICE_ID,
        );
        await completeRuntimeAccountLogin(runtime, desktopCaller);

        const realm = new Realm({
          transport: createRuntimeMediatedRealmTransport({
            runtime: studioRuntime,
            caller: studioCaller,
            realmBaseUrl: baseUrl,
          }),
        });
        const sourceMaterializationPacket = await createNimiRealmSourceMaterializationPacket(
          realm,
          () => {},
          SOURCE_REF,
          SOURCE_MATERIALIZATION_AUDIENCE,
        );
        const agentClient = createFixtureRuntimeAgentClient(runtime);
        const localAgent = await initializeFixtureLocalAgent({
          agentClient,
          sourceMaterializationPacket,
        });
        const conversation = await openFixtureConversation({
          agentClient,
          localAgent,
        });
        const conversationAnchorId = requireConversationAnchorId(conversation);
        const route = await createFixtureRouteProjection(runtime, 'text.generate');
        const embeddingRoute = await createFixtureRouteProjection(runtime, 'text.embed');
        const imageConnectorId = await createFixtureImageConnector(runtime, baseUrl);
        const imageModelDescriptor = await resolveFixtureImageConnectorModel(runtime, imageConnectorId);
        const imageRoute = await createFixtureRouteProjection(runtime, 'image.generate', {
          connectorId: imageConnectorId,
          connectorModel: imageModelDescriptor,
        });

        try {
          await input.run({
            endpoint,
            localModelsPath,
            runtime,
            realm,
            realmBaseUrl: baseUrl,
            realmRequests: requests,
            ownerUserId: OWNER_USER_ID,
            runtimeSourceRef: RUNTIME_SOURCE_REF,
            localAgentRef: localAgent.localAgentRef,
            localAgent,
            conversationAnchorId,
            conversation,
            route,
            embeddingRoute,
            imageRoute,
            sourceRef: SOURCE_REF,
            sourceMaterializationPacket,
            createSourceMaterializationPacket: () =>
              createNimiRealmSourceMaterializationPacket(
                realm,
                () => {},
                SOURCE_REF,
                SOURCE_MATERIALIZATION_AUDIENCE,
              ),
            sendTurn: (text) => sendFixtureTurn({
              agentClient,
              localAgent,
              conversationAnchorId,
              text,
            }),
            admitDeveloperRegisteredRuntimeAccountCaller: (accountInput) =>
              admitDeveloperRegisteredRuntimeAccountCaller(
                createRuntimeForEndpoint(endpoint, requireText(accountInput.appId, 'appId')),
                accountInput,
              ),
            admitLocalFirstPartyRuntimeAccountCaller: (accountInput) =>
              admitLocalFirstPartyRuntimeAccountCaller(
                createRuntimeForEndpoint(endpoint, requireText(accountInput.appId, 'appId')),
                accountInput,
              ),
          });
        } finally {
          await logoutRuntimeAccount(runtime, desktopCaller);
        }
      },
    });
    },
  });
}
