import * as realmClient from './realm/index.js';
import {
  createNimiError,
  createRuntimeClient,
  type RuntimeClient,
  type RuntimeClientConfig,
} from './runtime/index.js';
import { createScopeModule, type ScopeModule } from './scope/index.js';
import { ReasonCode } from './types/index.js';

const SDK_PROTOCOL_VERSION = '1';

export type CreateNimiRealmConfig = {
  baseUrl: string;
  accessToken?: string;
};

export type CreateNimiClientInput = {
  appId: string;
  protocolVersion?: string;
  realm?: CreateNimiRealmConfig;
  runtime?: Omit<RuntimeClientConfig, 'appId'>;
};

export type NimiClient = {
  appId: string;
  realm?: typeof realmClient;
  runtime?: RuntimeClient;
  scope: ScopeModule;
};

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function applyRealmConfig(input: CreateNimiRealmConfig): typeof realmClient {
  const baseUrl = normalize(input.baseUrl);
  if (!baseUrl) {
    throw createNimiError({
      message: 'createNimiClient realm.baseUrl is required when realm config is provided',
      reasonCode: ReasonCode.SDK_REALM_BASE_URL_REQUIRED,
      actionHint: 'set_realm_base_url',
      source: 'sdk',
    });
  }

  realmClient.OpenAPI.BASE = baseUrl;
  realmClient.OpenAPI.TOKEN = normalize(input.accessToken);
  return realmClient;
}

function createScopedRuntimeClient(runtime: RuntimeClient, scope: ScopeModule): RuntimeClient {
  return {
    ...runtime,
    appAuth: {
      ...runtime.appAuth,
      authorizeExternalPrincipal: async (request, options) => {
        const resolvedScopeCatalogVersion = scope.resolvePublishedCatalogVersion(
          request.scopeCatalogVersion,
        );
        const response = await runtime.appAuth.authorizeExternalPrincipal(
          {
            ...request,
            scopeCatalogVersion: resolvedScopeCatalogVersion,
          },
          options,
        );
        const issued = normalize((response as unknown as Record<string, unknown>).issuedScopeCatalogVersion);
        if (issued && issued !== resolvedScopeCatalogVersion) {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn(
              `[nimi-sdk] issuedScopeCatalogVersion mismatch: requested="${resolvedScopeCatalogVersion}" issued="${issued}"`,
            );
          }
        }
        return response;
      },
    },
  };
}

export function createNimiClient(input: CreateNimiClientInput): NimiClient {
  const appId = normalize(input.appId);
  if (!appId) {
    throw createNimiError({
      message: 'createNimiClient requires appId',
      reasonCode: ReasonCode.SDK_APP_ID_REQUIRED,
      actionHint: 'set_app_id',
      source: 'sdk',
    });
  }

  if (!input.realm && !input.runtime) {
    throw createNimiError({
      message: 'createNimiClient requires at least one of realm or runtime',
      reasonCode: ReasonCode.SDK_TARGET_REQUIRED,
      actionHint: 'configure_realm_or_runtime',
      source: 'sdk',
    });
  }

  if (input.protocolVersion) {
    const requested = String(input.protocolVersion).trim();
    if (requested && requested !== SDK_PROTOCOL_VERSION) {
      throw createNimiError({
        message: `Protocol version mismatch: SDK supports v${SDK_PROTOCOL_VERSION}, requested v${requested}`,
        reasonCode: ReasonCode.PROTOCOL_VERSION_MISMATCH,
        actionHint: 'use_matching_sdk_version',
        source: 'sdk',
      });
    }
  }

  const scope = createScopeModule({ appId });
  const runtime = input.runtime
    ? createScopedRuntimeClient(createRuntimeClient({
      ...input.runtime,
      appId,
    }), scope)
    : undefined;

  return {
    appId,
    realm: input.realm ? applyRealmConfig(input.realm) : undefined,
    runtime,
    scope,
  };
}
