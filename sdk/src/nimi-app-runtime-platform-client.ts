import type { RealmFetchImpl } from './realm/client-types.js';
import { createNimiError } from './core/errors.js';
import type { RuntimeClientDefaults, RuntimeOptions, RuntimeTransportConfig } from './runtime/types.js';
import { ReasonCode, type ReasonCodeValue } from './types/index.js';
import {
  createLocalFirstPartyRuntimePlatformClient,
  type PlatformClient,
} from './platform-client.js';

export type NimiAppAuthMode =
  | 'local-first-party'
  | 'third-party-nimi-app';

type SharedNimiAppRuntimePlatformClientInput = {
  appId: string;
  realmBaseUrl?: string;
  runtimeTransport?: RuntimeTransportConfig | null;
  runtimeDefaults?: RuntimeClientDefaults;
  runtimeOptions?: Omit<RuntimeOptions, 'appId' | 'transport' | 'auth' | 'subjectContext' | 'defaults'>;
  realmFetchImpl?: RealmFetchImpl;
};

export type NimiAppRuntimePlatformClientInput =
  SharedNimiAppRuntimePlatformClientInput & (
    | {
        mode: 'local-first-party';
        // K-AUTHSVC-014: opt into developer registration for local developer
        // testing. The runtime developer-registration gate (off by default), not
        // this flag, performs admission. Scaffolds set this only in local dev.
        developerRegistration?: boolean;
      }
    | {
        mode: 'third-party-nimi-app';
      }
  );

export type NimiAppAuthUnavailable = {
  status: 'unavailable' | 'action-required';
  mode: NimiAppAuthMode;
  reasonCode: ReasonCodeValue;
  actionHint: string;
  message: string;
};

export type NimiAppAuthProjection =
  | {
      status: 'ready';
      mode: NimiAppAuthMode;
      client: PlatformClient;
      auth: {
        state: 'ready';
        source: 'runtime-local-first-party';
      };
    }
  | NimiAppAuthUnavailable;

function unavailable(input: {
  status: NimiAppAuthUnavailable['status'];
  mode: NimiAppAuthMode;
  reasonCode: ReasonCodeValue;
  actionHint: string;
  message: string;
}): NimiAppAuthUnavailable {
  return {
    status: input.status,
    mode: input.mode,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    message: input.message,
  };
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function assertSupportedMode(mode: string): asserts mode is NimiAppAuthMode {
  if (mode === 'local-first-party' || mode === 'third-party-nimi-app') {
    return;
  }
  throw createNimiError({
    message: `unsupported Nimi App auth mode: ${mode || '(empty)'}`,
    reasonCode: ReasonCode.SDK_AUTH_MODE_INVALID,
    actionHint: 'use_supported_nimi_app_auth_mode',
    source: 'sdk',
  });
}

function toSharedPlatformInput(input: SharedNimiAppRuntimePlatformClientInput) {
  return {
    appId: input.appId,
    realmBaseUrl: input.realmBaseUrl,
    runtimeTransport: input.runtimeTransport,
    runtimeDefaults: input.runtimeDefaults,
    runtimeOptions: input.runtimeOptions,
    realmFetchImpl: input.realmFetchImpl,
  };
}

export async function createNimiAppRuntimePlatformClient(
  input: NimiAppRuntimePlatformClientInput,
): Promise<NimiAppAuthProjection> {
  const mode = normalizeText(input.mode);
  assertSupportedMode(mode);

  if (mode === 'local-first-party') {
    try {
      const client = await createLocalFirstPartyRuntimePlatformClient({
        ...toSharedPlatformInput(input),
        developerRegistration: input.mode === 'local-first-party' && input.developerRegistration === true,
        // Runtime ExecuteScenario is authz-gated on the `ai.spend.meter` protected
        // capability (runtime grpc authz interceptor). A Nimi App consumes the
        // high-level runtime.ai.* surface, so the SDK must auto-issue that
        // spend-meter token for AI calls; without it every text/embed/media
        // execution fails closed with PRINCIPAL_UNAUTHORIZED. The Runtime account
        // login supplies the subject the token is attributed to.
        runtimeOptions: {
          ...input.runtimeOptions,
          protectedAccess: {
            ...input.runtimeOptions?.protectedAccess,
            autoIssueForAi: true,
          },
        },
      });
      return {
        status: 'ready',
        mode,
        client,
        auth: {
          state: 'ready',
          source: 'runtime-local-first-party',
        },
      };
    } catch (error) {
      const reasonCode = typeof error === 'object' && error !== null && 'reasonCode' in error
        ? String((error as { reasonCode?: string }).reasonCode || ReasonCode.RUNTIME_UNAVAILABLE) as ReasonCodeValue
        : ReasonCode.RUNTIME_UNAVAILABLE;
      return unavailable({
        status: 'action-required',
        mode,
        reasonCode,
        actionHint: 'complete_runtime_local_first_party_account_setup',
        message: error instanceof Error ? error.message : 'local first-party Runtime account setup is required',
      });
    }
  }

  // mode === 'third-party-nimi-app': the productized third-party Runtime app
  // session projection is not exposed by this SDK/runtime pair yet. Local app
  // development connects through 'local-first-party' login + the runtime
  // developer-registration gate, not a separate standalone developer session.
  return unavailable({
    status: 'unavailable',
    mode,
    reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    actionHint: 'wait_for_runtime_nimi_app_session_projection',
    message: 'third-party Nimi App Runtime session projection is not exposed by this SDK/runtime pair',
  });
}
