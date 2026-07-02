import { randomUUID } from 'node:crypto';

import type {
  AccountCaller,
  ConversationAnchorSnapshot,
  SendAppMessageResponse,
} from '../core-generated/runtime-typed-client';
import type { Realm } from '../realm';
import type {
  NimiRealmCoreSourceRef,
  NimiRealmSourceMaterializationPacket,
} from '../realm/social';
import type { Runtime } from './index';
import type { NimiRuntimeRouteTargetRef } from './route-options';
import type { NimiRuntimeAgentInitializedLocalAgent } from './runtime-agent-lifecycle';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';

export const SOURCE_MATERIALIZATION_AUDIENCE = 'nimi.desktop.local-agent.materialization';

export type RuntimeAgentLiveE2ERealmRequest = {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly authorization: string;
  readonly body: unknown;
};

export type RuntimeAgentLiveE2EFixtureContext = {
  readonly endpoint: string;
  readonly localModelsPath: string;
  readonly runtime: Runtime;
  readonly realm: Realm;
  readonly realmBaseUrl: string;
  readonly realmRequests: readonly RuntimeAgentLiveE2ERealmRequest[];
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly localAgent: NimiRuntimeAgentInitializedLocalAgent;
  readonly conversationAnchorId: string;
  readonly conversation: ConversationAnchorSnapshot;
  readonly route: RuntimeAgentLiveE2ERouteProjection;
  readonly embeddingRoute: RuntimeAgentLiveE2ERouteProjection;
  readonly imageRoute: RuntimeAgentLiveE2ERouteProjection;
  readonly sourceRef: NimiRealmCoreSourceRef;
  readonly sourceMaterializationPacket: NimiRealmSourceMaterializationPacket;
  readonly createSourceMaterializationPacket: () => Promise<NimiRealmSourceMaterializationPacket>;
  readonly sendTurn: (text: string) => Promise<SendAppMessageResponse>;
  readonly admitDeveloperRegisteredRuntimeAccountCaller: (
    input: RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
  ) => Promise<AccountCaller>;
  readonly admitLocalFirstPartyRuntimeAccountCaller: (
    input: RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
  ) => Promise<AccountCaller>;
};

export type RuntimeAgentLiveE2ERouteProjection = {
  readonly capability: 'text.generate' | 'text.embed' | 'image.generate';
  readonly selectedTargetRefKind: string;
  readonly resolvedBindingRef: string;
  readonly targetRef: NimiRuntimeRouteTargetRef;
  readonly executionBinding: {
    readonly route: 'local' | 'cloud';
    readonly modelId: string;
    readonly connectorId?: string;
  };
};

export type RuntimeAgentLiveE2EDeveloperRegisteredAccountInput = {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly appVersion?: string;
  readonly capabilities?: readonly string[];
  readonly scopes?: readonly string[];
};

export const DESKTOP_APP_ID = 'nimi.desktop';
export const DESKTOP_APP_INSTANCE_ID = 'nimi.desktop.local-first-party';
export const DESKTOP_DEVICE_ID = 'desktop-shell';
export const REALM_WORLD_STUDIO_APP_ID = 'nimi.realm-world-studio';
export const REALM_WORLD_STUDIO_APP_INSTANCE_ID = 'nimi.realm-world-studio.local-first-party';
export const REALM_STUDIO_DEVICE_ID = 'device-1';
export const RUNTIME_ACCOUNT_REDIRECT_URI = 'http://localhost:46373/oauth/callback';
export const RUNTIME_ACCOUNT_ACCESS_TOKEN = 'runtime-live-access-token';
export const RUNTIME_ACCOUNT_REFRESH_TOKEN = 'runtime-live-refresh-token';
export const SOURCE_PACKET_HMAC_SECRET = 'sdk-runtime-agent-live-e2e-source-packet-secret';
export const OWNER_USER_ID = 'user-runtime-agent-live';
export const SOURCE_REF: NimiRealmCoreSourceRef = {
  kind: 'worldCharacter',
  worldId: 'world-runtime-live',
  sourceId: 'source-runtime-live',
  sourceContentHash: 'hash-runtime-live',
};
export const RUNTIME_SOURCE_REF =
  `runtime-source:${SOURCE_REF.kind}:${SOURCE_REF.worldId}:${SOURCE_REF.sourceId}:${SOURCE_REF.sourceContentHash}`;
export const LOCAL_TEXT_MODEL_ID = 'runtime-agent-live-e2e';
export const LOCAL_TEXT_MODEL_REF = `local/${LOCAL_TEXT_MODEL_ID}`;
export const LOCAL_TEXT_ASSET_ID = 'local-asset-runtime-agent-live-e2e-chat';
export const LOCAL_EMBED_MODEL_ID = 'runtime-agent-live-e2e-embedding';
export const LOCAL_EMBED_MODEL_REF = `local/${LOCAL_EMBED_MODEL_ID}`;
export const LOCAL_EMBED_ASSET_ID = 'local-asset-runtime-agent-live-e2e-embedding';
export const LOCAL_EMBED_DIMENSIONS = 4;
export const FIXTURE_IMAGE_PROVIDER = 'openai';
export const FIXTURE_IMAGE_MODEL_ID = 'gpt-image-1.5';
export const FIXTURE_IMAGE_CONNECTOR_LABEL = 'Runtime Agent live image fixture';
export const LOCAL_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

export function liveIdempotencyOptions(
  scope: string,
  options?: Parameters<typeof withNimiRuntimeIdempotencyMetadata>[0],
): ReturnType<typeof withNimiRuntimeIdempotencyMetadata> {
  return withNimiRuntimeIdempotencyMetadata(
    options,
    `runtime-agent-live-e2e:${scope}:${randomUUID()}`,
  );
}

export function runtimeAgentLiveE2EErrorDiagnostics(error: unknown): Record<string, unknown> {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  return {
    name: error instanceof Error ? error.name : '',
    message: error instanceof Error ? error.message : String(error),
    code: record.code,
    reasonCode: record.reasonCode,
    actionHint: record.actionHint,
    source: record.source,
    detail: record.detail,
    cause: error instanceof Error && error.cause
      ? runtimeAgentLiveE2EErrorDiagnostics(error.cause)
      : undefined,
  };
}

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Runtime agent live e2e fixture requires ${field}`);
  }
  return normalized;
}

export function normalizeStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

export function normalizeLocalModelRef(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) return LOCAL_TEXT_MODEL_REF;
  return normalized.startsWith('local/') ? normalized : `local/${normalized}`;
}
