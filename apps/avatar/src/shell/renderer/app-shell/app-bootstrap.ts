import { clearPlatformClient, createPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import { createRuntimeProtectedScopeHelper } from '@nimiplatform/sdk/runtime/browser';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { invoke as tauriInvoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
  type SharedDesktopAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import {
  clearAuthSession,
  getAvatarLaunchContext,
  getRuntimeDefaults,
  hasTauriInvoke,
  loadAuthSession,
  saveAuthSession,
  startDaemon,
  type AvatarLaunchContext,
  watchAuthSessionChanges,
} from '@renderer/bridge';
import { createDriver, resolveDriverKind } from '../driver/factory.js';
import { startAvatarRuntimeCarrier, type AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { resolveAgentCenterAvatarPackageManifest } from '../live2d/model-loader.js';
import { readAvatarShellSettings } from '../settings-state.js';
import type { AgentDataDriver } from '../driver/types.js';
import { startAvatarVoiceCaptureSession, type AvatarVoiceCaptureSession } from '../voice-capture.js';
import { bootstrapAuthSession } from './bootstrap-auth.js';
import { recordAvatarEvidenceEventually } from './avatar-evidence.js';
import {
  useAvatarStore,
  type AvatarAuthFailureReason,
  type AvatarAuthUser,
} from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';

export type BootstrapHandle = {
  driver: AgentDataDriver;
  carrier?: AvatarRuntimeCarrier | null;
  getVoiceInputAvailability(input: {
    agentId: string;
    conversationAnchorId: string;
  }): Promise<{
    available: boolean;
    reason: string | null;
  }>;
  startVoiceCapture(input: {
    agentId: string;
    conversationAnchorId: string;
    onLevelChange?: (amplitude: number) => void;
  }): Promise<AvatarVoiceCaptureSession>;
  submitVoiceCaptureTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    audioBytes: Uint8Array;
    mimeType: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{
    transcript: string;
  }>;
  interruptTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    turnId?: string;
    reason?: string;
  }): Promise<void>;
  requestTextTurn(input: {
    agentId: string;
    conversationAnchorId: string;
    text: string;
  }): Promise<void>;
  shutdown(): Promise<void>;
};

function readNormalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type TauriRuntimeSdkHook = {
  invoke: (command: string, payload?: unknown) => Promise<unknown>;
  listen: (
    eventName: string,
    handler: (event: { event?: string; id?: number; payload: unknown }) => void,
  ) => Promise<UnlistenFn>;
};

function installTauriRuntimeSdkHook(): void {
  if (!hasTauriInvoke()) {
    return;
  }
  const hook: TauriRuntimeSdkHook = {
    invoke: (command, payload) => tauriInvoke(command, payload as InvokeArgs | undefined),
    listen: (eventName, handler) => tauriListen(eventName, handler),
  };
  const target = globalThis as typeof globalThis & {
    __NIMI_TAURI_RUNTIME__?: TauriRuntimeSdkHook;
    window?: Window & { __NIMI_TAURI_RUNTIME__?: TauriRuntimeSdkHook };
  };
  target.__NIMI_TAURI_RUNTIME__ = hook;
  if (target.window) {
    target.window.__NIMI_TAURI_RUNTIME__ = hook;
  }
}

function applyLaunchContextRuntimeDefaults(
  runtimeDefaults: Awaited<ReturnType<typeof getRuntimeDefaults>>,
  launchContext: AvatarLaunchContext,
): Awaited<ReturnType<typeof getRuntimeDefaults>> {
  const realmBaseUrl = readNormalizedString(launchContext.realmBaseUrl);
  const worldId = readNormalizedString(launchContext.worldId);
  if (!realmBaseUrl && !worldId) {
    return runtimeDefaults;
  }
  return {
    ...runtimeDefaults,
    realm: {
      ...runtimeDefaults.realm,
      ...(realmBaseUrl ? { realmBaseUrl } : {}),
    },
    runtime: {
      ...runtimeDefaults.runtime,
      ...(worldId ? { worldId } : {}),
    },
  };
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForAvatarLaunchContext(timeoutMs: number): Promise<AvatarLaunchContext> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await getAvatarLaunchContext();
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw new Error(`avatar launch context was not bound within ${timeoutMs}ms: ${errorMessage(lastError)}`);
}

function resolveConfiguredAvatarModelPath(): string {
  return readNormalizedString(import.meta.env['VITE_AVATAR_MODEL_PATH'])
    || readNormalizedString(import.meta.env['NIMI_AVATAR_MODEL_PATH']);
}

type ProtoStructLike = {
  fields?: Record<string, ProtoValueLike>;
};

type ProtoValueLike = {
  kind?: {
    oneofKind?: 'nullValue' | 'numberValue' | 'stringValue' | 'boolValue' | 'structValue' | 'listValue';
    nullValue?: number;
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
    structValue?: ProtoStructLike;
    listValue?: {
      values?: ProtoValueLike[];
    };
  };
};

function protoValueToJson(value?: ProtoValueLike): unknown {
  switch (value?.kind?.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue ?? false;
    case 'numberValue':
      return value.kind.numberValue ?? 0;
    case 'stringValue':
      return value.kind.stringValue ?? '';
    case 'structValue':
      return protoStructToJson(value.kind.structValue);
    case 'listValue':
      return (value.kind.listValue?.values || []).map((item) => protoValueToJson(item));
    default:
      return null;
  }
}

function protoStructToJson(value?: ProtoStructLike): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value?.fields || {})) {
    output[key] = protoValueToJson(item);
  }
  return output;
}

function parseAvatarBackendKind(value: unknown): AvatarPresentationProfile['backendKind'] | null {
  const normalized = readNormalizedString(value);
  if (
    normalized === 'vrm'
    || normalized === 'live2d'
    || normalized === 'sprite2d'
    || normalized === 'canvas2d'
    || normalized === 'video'
  ) {
    return normalized;
  }
  return null;
}

function parseAvatarPresentationProfile(value: unknown): AvatarPresentationProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const backendKind = parseAvatarBackendKind(record.backendKind);
  const avatarAssetRef = readNormalizedString(record.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    return null;
  }
  return {
    backendKind,
    avatarAssetRef,
    expressionProfileRef: readNormalizedString(record.expressionProfileRef) || null,
    idlePreset: readNormalizedString(record.idlePreset) || null,
    interactionPolicyRef: readNormalizedString(record.interactionPolicyRef) || null,
    defaultVoiceReference: readNormalizedString(record.defaultVoiceReference) || null,
  };
}

function readAgentPresentationProfile(metadata?: ProtoStructLike): AvatarPresentationProfile | null {
  const json = protoStructToJson(metadata);
  return parseAvatarPresentationProfile(json.presentationProfile);
}

function resolveLocalLive2DAssetPath(assetRef: string): string | null {
  const normalized = readNormalizedString(assetRef);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized;
  }
  if (/^file:\/\//i.test(normalized) || /^asset:\/\/localhost\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      return decodeURIComponent(parsed.pathname || '') || null;
    } catch {
      return null;
    }
  }
  return null;
}

function resolveRuntimeAppId(launchContext: AvatarLaunchContext): string {
  const explicitRuntimeAppId = readNormalizedString(launchContext.runtimeAppId);
  if (explicitRuntimeAppId) {
    return explicitRuntimeAppId;
  }
  const launchedBy = readNormalizedString(launchContext.launchedBy);
  if (launchedBy === 'desktop') {
    return 'nimi.desktop';
  }
  return launchedBy || 'nimi.avatar';
}

async function resolveRuntimePresentationProfile(input: {
  runtime: PlatformClient['runtime'];
  agentId: string;
  subjectUserId: string;
}): Promise<AvatarPresentationProfile | null> {
  const protectedScopes = createRuntimeProtectedScopeHelper({
    runtime: input.runtime,
    getSubjectUserId: () => input.subjectUserId,
  });
  const response = await protectedScopes.withScopes(['runtime.agent.read'], (options) => input.runtime.agent.getAgent({
    context: {
      appId: input.runtime.appId,
      subjectUserId: input.subjectUserId,
    },
    agentId: input.agentId,
  }, options));
  return readAgentPresentationProfile(response.agent?.metadata);
}

async function resolveAvatarModelPath(input: {
  runtime: PlatformClient['runtime'];
  agentId: string;
  subjectUserId: string;
}): Promise<string> {
  const profile = await resolveRuntimePresentationProfile(input);
  if (profile) {
    if (profile.backendKind !== 'live2d') {
      throw new Error(`avatar presentation profile backend is not Live2D: ${profile.backendKind}`);
    }
    const modelPath = resolveLocalLive2DAssetPath(profile.avatarAssetRef);
    if (!modelPath) {
      throw new Error('avatar presentation profile Live2D asset ref must resolve to a local model path');
    }
    return modelPath;
  }
  const configuredPath = resolveConfiguredAvatarModelPath();
  if (configuredPath) {
    return configuredPath;
  }
  throw new Error('avatar Live2D model path is not configured by Runtime presentation profile or NIMI_AVATAR_MODEL_PATH');
}

type RuntimeExecutionBinding = {
  route: 'local' | 'cloud';
  modelId: string;
  connectorId?: string;
};

type RuntimeWithRoute = PlatformClient['runtime'] & {
  route: {
    listOptions: (input: { capability: 'audio.transcribe' }) => Promise<{
      selected: {
        source: 'local' | 'cloud';
        connectorId?: string;
        model?: string;
        modelId?: string;
        localModelId?: string;
      } | null;
      resolvedDefault?: {
        source: 'local' | 'cloud';
        connectorId?: string;
        model?: string;
        modelId?: string;
        localModelId?: string;
      } | null;
    }>;
    checkHealth: (input: {
      capability: 'audio.transcribe';
      binding: {
        source: 'local' | 'cloud';
        connectorId?: string;
        model?: string;
        modelId?: string;
        localModelId?: string;
      };
    }) => Promise<{ healthy: boolean }>;
  };
};

function normalizeWatchedAuthUser(
  session: SharedDesktopAuthSession,
  fallbackUser: AvatarAuthUser,
): AvatarAuthUser {
  const displayName = readNormalizedString(session.user?.displayName) || fallbackUser.displayName;
  const email = readNormalizedString(session.user?.email) || readNormalizedString(fallbackUser.email);
  const avatarUrl = readNormalizedString(session.user?.avatarUrl) || readNormalizedString(fallbackUser.avatarUrl);
  return {
    id: fallbackUser.id,
    displayName,
    ...(email ? { email } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

async function loadDefaultMockScenarioJson(): Promise<string> {
  const module = await import('../mock/scenarios/default.mock.json?raw');
  return module.default;
}

async function resolveConversationAnchorId(
  runtime: PlatformClient['runtime'],
  launchContext: AvatarLaunchContext,
): Promise<string> {
  if (launchContext.anchorMode === 'existing') {
    return launchContext.conversationAnchorId || '';
  }
  const opened = await runtime.agent.anchors.open({
    agentId: launchContext.agentId,
    metadata: {
      surface: 'avatar-carrier',
      launchedBy: launchContext.launchedBy,
      avatarInstanceId: launchContext.avatarInstanceId,
      sourceSurface: launchContext.sourceSurface || 'desktop-avatar-launcher',
    },
  });
  const record = opened as unknown as Record<string, unknown>;
  const conversationAnchorId = readNormalizedString(
    record.conversationAnchorId ?? record.conversation_anchor_id,
  );
  if (!conversationAnchorId) {
    throw new Error('runtime.agent anchor open did not return conversationAnchorId');
  }
  return conversationAnchorId;
}

function resolveExecutionBinding(input: {
  runtimeDefaults: ReturnType<typeof useAvatarStore.getState>['runtime']['defaults'];
  bundle: ReturnType<typeof useAvatarStore.getState>['bundle'];
}): RuntimeExecutionBinding | null {
  const executionBinding = input.bundle?.custom?.['execution_binding'];
  if (executionBinding && typeof executionBinding === 'object') {
    const record = executionBinding as Record<string, unknown>;
    const route = readNormalizedString(record.route);
    const modelId = readNormalizedString(record.modelId);
    const connectorId = readNormalizedString(record.connectorId);
    if ((route === 'local' || route === 'cloud') && modelId) {
      return {
        route,
        modelId,
        ...(connectorId ? { connectorId } : {}),
      };
    }
  }

  const runtimeFields = input.runtimeDefaults?.runtime;
  const modelId = readNormalizedString(runtimeFields?.localProviderModel);
  const connectorId = readNormalizedString(runtimeFields?.connectorId);
  if (!modelId) {
    return null;
  }
  return {
    route: connectorId ? 'cloud' : 'local',
    modelId,
    ...(connectorId ? { connectorId } : {}),
  };
}

async function resolveCapabilityBinding(
  runtime: PlatformClient['runtime'],
  capability: 'audio.transcribe',
): Promise<RuntimeExecutionBinding> {
  const runtimeWithRoute = runtime as RuntimeWithRoute;
  const options = await runtimeWithRoute.route.listOptions({ capability });
  const selected = options.selected ?? options.resolvedDefault ?? null;
  if (!selected) {
    throw new Error('Foreground voice requires an admitted transcribe route.');
  }
  const modelId = readNormalizedString(selected.modelId || selected.model || selected.localModelId);
  if (!modelId) {
    throw new Error('Foreground voice requires a resolved transcribe model.');
  }
  const health = await runtimeWithRoute.route.checkHealth({
    capability,
    binding: selected,
  });
  if (!health.healthy) {
    throw new Error('Foreground voice is unavailable because the transcribe route is not ready.');
  }
  return {
    route: selected.source,
    modelId,
    ...(readNormalizedString(selected.connectorId) ? { connectorId: readNormalizedString(selected.connectorId) } : {}),
  };
}

export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  const store = useAvatarStore.getState();

  let shellUnlisten: (() => void) | null = null;
  let stopAuthSessionWatch = () => {};
  let driver: AgentDataDriver | null = null;
  let carrier: AvatarRuntimeCarrier | null = null;
  let unsubscribeStatus = () => {};
  let unsubscribeBundle = () => {};
  let shouldClearPlatformClient = false;
  let cleanedUp = false;
  let authResolutionEvidence: Record<string, unknown> | null = null;
  let getVoiceInputAvailability: BootstrapHandle['getVoiceInputAvailability'] = async () => ({
    available: false,
    reason: 'Foreground voice is unavailable outside runtime-bound mode.',
  });
  let startVoiceCapture: BootstrapHandle['startVoiceCapture'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let submitVoiceCaptureTurn: BootstrapHandle['submitVoiceCaptureTurn'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let interruptTurn: BootstrapHandle['interruptTurn'] = async () => {
    throw new Error('Foreground voice is unavailable outside runtime-bound mode');
  };
  let requestTextTurn: BootstrapHandle['requestTextTurn'] = async () => {
    throw new Error('avatar companion input is unavailable outside runtime-bound mode');
  };

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    unsubscribeStatus();
    unsubscribeBundle();
    shellUnlisten?.();
    stopAuthSessionWatch();
    carrier?.shutdown();
    carrier = null;
    if (driver) {
      await driver.stop().catch(() => {});
    }
    if (shouldClearPlatformClient) {
      useAvatarStore.getState().clearRuntimeBinding();
      clearPlatformClient();
    }
  };

  try {
    if (isTauriRuntime()) {
      const shellSettings = readAvatarShellSettings();
      useAvatarStore.getState().setAlwaysOnTop(shellSettings.alwaysOnTop);
      shellUnlisten = await onShellReady((payload) => {
        useAvatarStore.getState().markShellReady({ width: payload.width, height: payload.height });
      });
      await setAlwaysOnTop(shellSettings.alwaysOnTop);
    } else {
      // Browser dev mode (pnpm dev:renderer without Tauri shell) — mark shell ready immediately with current window size
      useAvatarStore.getState().markShellReady({
        width: typeof window !== 'undefined' ? window.innerWidth : 400,
        height: typeof window !== 'undefined' ? window.innerHeight : 600,
      });
    }

    const driverKind = resolveDriverKind();

    if (driverKind === 'mock') {
      const scenarioJson = await loadDefaultMockScenarioJson();
      useAvatarStore.getState().setConsumeMode({
        mode: 'mock',
        authority: 'fixture',
        fixtureId: 'default',
        fixturePlaying: true,
      });
      driver = createDriver({
        kind: 'mock',
        scenarioJson,
        scenarioSource: 'default.mock.json',
      });
    } else {
      if (!isTauriRuntime() || !hasTauriInvoke()) {
        throw new Error('avatar real runtime bootstrap requires Tauri runtime');
      }
      installTauriRuntimeSdkHook();
      const launchContext = await waitForAvatarLaunchContext(5_000);
      useAvatarStore.getState().setLaunchContext(launchContext);

      const runtimeDefaults = applyLaunchContextRuntimeDefaults(
        await getRuntimeDefaults(),
        launchContext,
      );
      useAvatarStore.getState().setRuntimeDefaults(runtimeDefaults);
      const resolvedBootstrapAuthSession = await resolveDesktopBootstrapAuthSession({
        realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
        envAccessToken: runtimeDefaults.realm.accessToken,
        loadPersistedSession: () => loadAuthSession(),
      });
      authResolutionEvidence = {
        realm_base_url: runtimeDefaults.realm.realmBaseUrl,
        env_access_token_present: Boolean(String(runtimeDefaults.realm.accessToken || '').trim()),
        source: resolvedBootstrapAuthSession.source,
        resolution: resolvedBootstrapAuthSession.resolution,
        has_session: Boolean(resolvedBootstrapAuthSession.session),
        has_access_token: Boolean(String(resolvedBootstrapAuthSession.session?.accessToken || '').trim()),
        session_realm_base_url: String(resolvedBootstrapAuthSession.session?.realmBaseUrl || '').trim() || null,
        should_clear_persisted_session: resolvedBootstrapAuthSession.shouldClearPersistedSession,
      };
      if (resolvedBootstrapAuthSession.shouldClearPersistedSession) {
        await clearAuthSession();
      }

      let bootstrapAccessToken = String(resolvedBootstrapAuthSession.session?.accessToken || '').trim();
      let bootstrapRefreshToken = String(resolvedBootstrapAuthSession.session?.refreshToken || '').trim();
      const resolveCurrentAccessToken = () => {
        const fromStore = String(useAvatarStore.getState().auth.accessToken || '').trim();
        return fromStore || bootstrapAccessToken;
      };
      const resolveCurrentRefreshToken = () => {
        const fromStore = String(useAvatarStore.getState().auth.refreshToken || '').trim();
        return fromStore || bootstrapRefreshToken;
      };
      const clearPersistedSession = async () => {
        bootstrapAccessToken = '';
        bootstrapRefreshToken = '';
        await clearAuthSession();
      };
      const failClosedAuthenticatedConsumer = async (
        reason: AvatarAuthFailureReason,
      ) => {
        if (cleanedUp) {
          return;
        }
        const storeState = useAvatarStore.getState();
        storeState.clearBundle();
        storeState.clearRuntimeBinding();
        storeState.clearAuthSession(reason);
        storeState.setDriverStatus('stopped');
        await cleanup();
      };

      const runtimeAppId = resolveRuntimeAppId(launchContext);
      const { runtime, realm } = await createPlatformClient({
        appId: runtimeAppId,
        realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
        accessToken: bootstrapAccessToken,
        accessTokenProvider: resolveCurrentAccessToken,
        refreshTokenProvider: resolveCurrentRefreshToken,
        runtimeTransport: {
          type: 'tauri-ipc',
          commandNamespace: 'runtime_bridge',
          eventNamespace: 'runtime_bridge',
        },
        sessionStore: {
          getAccessToken: resolveCurrentAccessToken,
          getRefreshToken: resolveCurrentRefreshToken,
          getSubjectUserId: () => useAvatarStore.getState().auth.user?.id ?? '',
          getCurrentUser: () => useAvatarStore.getState().auth.user,
          setAuthSession: (user, accessToken, refreshToken) => {
            bootstrapAccessToken = String(accessToken || '').trim();
            if (refreshToken !== undefined) {
              bootstrapRefreshToken = String(refreshToken || '').trim();
            }
            const record = user as Record<string, unknown> | null;
            const userId = readNormalizedString(record?.['id']);
            if (!userId) {
              return;
            }
            useAvatarStore.getState().setAuthSession(
              {
                id: userId,
                displayName: readNormalizedString(record?.['displayName']),
                ...(readNormalizedString(record?.['email']) ? { email: readNormalizedString(record?.['email']) } : {}),
                ...(readNormalizedString(record?.['avatarUrl']) ? { avatarUrl: readNormalizedString(record?.['avatarUrl']) } : {}),
              },
              accessToken,
              refreshToken || '',
            );
            void persistSharedDesktopAuthSession({
              realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
              accessToken,
              refreshToken,
              user: record,
              saveSession: (session) => saveAuthSession(session),
              clearSession: () => clearAuthSession(),
            });
          },
          clearAuthSession: async () => {
            await clearPersistedSession();
            await failClosedAuthenticatedConsumer('shared_session_invalid');
          },
        },
      });
      shouldClearPlatformClient = true;

      const authUser = await bootstrapAuthSession({
        realm,
        accessToken: bootstrapAccessToken,
        refreshToken: bootstrapRefreshToken,
        source: resolvedBootstrapAuthSession.source,
        realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
        clearPersistedSession,
      });

      const startedDaemon = await startDaemon();
      if (!startedDaemon.running) {
        throw new Error(startedDaemon.lastError?.trim() || 'runtime daemon failed to start');
      }
      await Promise.race([
        runtime.ready(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('avatar runtime ready timeout (15s)')), 15_000);
        }),
      ]);

      const worldId = readNormalizedString(runtimeDefaults.runtime.worldId);
      if (!worldId) {
        throw new Error('avatar runtime defaults are missing runtime.worldId');
      }

      const agentId = readNormalizedString(launchContext.agentId);
      if (!agentId) {
        throw new Error('avatar launch context is missing agentId');
      }
      const conversationAnchorId = await resolveConversationAnchorId(runtime, launchContext);
      if (!conversationAnchorId) {
        throw new Error('avatar launch context did not resolve conversationAnchorId');
      }
      useAvatarStore.getState().setConsumeMode({
        mode: 'sdk',
        authority: 'runtime',
        fixtureId: null,
        fixturePlaying: false,
      });
      useAvatarStore.getState().setRuntimeBinding({
        avatarInstanceId: launchContext.avatarInstanceId,
        conversationAnchorId,
        agentId,
        worldId,
      });
      recordAvatarEvidenceEventually({
        kind: 'avatar.startup.runtime-bound',
        detail: {
          driver_kind: 'sdk',
          authority: 'runtime',
          agent_id: agentId,
          conversation_anchor_id: conversationAnchorId,
          avatar_instance_id: launchContext.avatarInstanceId,
          world_id: worldId,
          launched_by: launchContext.launchedBy,
          runtime_app_id: runtimeAppId,
          source_surface: launchContext.sourceSurface || null,
        },
      });
      driver = createDriver({
        kind: 'sdk',
        sdk: {
          runtime,
          agentId,
          conversationAnchorId,
          activeWorldId: worldId,
          activeUserId: authUser.id,
          locale: navigator.language || 'en-US',
          windowInfo: () => {
            const state = useAvatarStore.getState();
            return {
              x: 0,
              y: 0,
              width: state.shell.windowSize.width,
              height: state.shell.windowSize.height,
            };
          },
        },
      });
      carrier = await startAvatarRuntimeCarrier({
        driver,
        modelManifest: await resolveAgentCenterAvatarPackageManifest({
          agentCenterAccountId: launchContext.agentCenterAccountId,
          agentId,
          avatarPackageKind: launchContext.avatarPackageKind,
          avatarPackageId: launchContext.avatarPackageId,
          avatarPackageSchemaVersion: launchContext.avatarPackageSchemaVersion,
        }),
      });

      if (resolvedBootstrapAuthSession.source === 'persisted') {
        stopAuthSessionWatch = watchAuthSessionChanges({
          initialSession: resolvedBootstrapAuthSession.session,
          onChange: async (session) => {
            if (!session) {
              await failClosedAuthenticatedConsumer('shared_session_missing');
              return;
            }

            const sessionRealmBaseUrl = readNormalizedString(session.realmBaseUrl);
            if (sessionRealmBaseUrl !== runtimeDefaults.realm.realmBaseUrl) {
              await failClosedAuthenticatedConsumer('shared_session_realm_mismatch');
              return;
            }

            const sessionUserId = readNormalizedString(session.user?.id);
            if (!sessionUserId || sessionUserId !== authUser.id) {
              await failClosedAuthenticatedConsumer('shared_session_user_mismatch');
              return;
            }

            const nextAccessToken = readNormalizedString(session.accessToken);
            if (!nextAccessToken) {
              await failClosedAuthenticatedConsumer('shared_session_invalid');
              return;
            }

            const nextRefreshToken = readNormalizedString(session.refreshToken);
            const currentAuth = useAvatarStore.getState().auth;
            const nextUser = normalizeWatchedAuthUser(session, currentAuth.user ?? authUser);
            const changed = currentAuth.accessToken !== nextAccessToken
              || currentAuth.refreshToken !== nextRefreshToken
              || currentAuth.user?.displayName !== nextUser.displayName
              || currentAuth.user?.email !== nextUser.email
              || currentAuth.user?.avatarUrl !== nextUser.avatarUrl;

            if (!changed) {
              return;
            }

            bootstrapAccessToken = nextAccessToken;
            bootstrapRefreshToken = nextRefreshToken;
            useAvatarStore.getState().setAuthSession(nextUser, nextAccessToken, nextRefreshToken);
          },
          onError: async () => {
            await failClosedAuthenticatedConsumer('shared_session_invalid');
          },
        });
      }

      requestTextTurn = async (input) => {
        const normalizedText = readNormalizedString(input.text);
        if (!normalizedText) {
          throw new Error('avatar companion input requires non-empty text');
        }
        if (cleanedUp) {
          throw new Error('avatar companion input is unavailable after shutdown');
        }
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || state.auth.status !== 'authenticated') {
          throw new Error('avatar companion input requires active runtime auth');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('avatar companion input requires the current explicit agent and anchor binding');
        }
        const executionBinding = resolveExecutionBinding({
          runtimeDefaults,
          bundle: state.bundle,
        });
        if (!executionBinding) {
          throw new Error('avatar companion input requires an explicit execution binding');
        }
        await runtime.agent.turns.request({
          agentId: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
          worldId,
          messages: [{ role: 'user', content: normalizedText }],
          executionBinding,
        });
      };

      getVoiceInputAvailability = async (input) => {
        try {
          if (cleanedUp) {
            throw new Error('Foreground voice is unavailable after shutdown.');
          }
          const state = useAvatarStore.getState();
          if (state.consume.authority !== 'runtime' || state.auth.status !== 'authenticated') {
            throw new Error('Foreground voice requires active runtime auth.');
          }
          if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
            throw new Error('Foreground voice requires the current explicit agent and anchor binding.');
          }
          await resolveCapabilityBinding(runtime, 'audio.transcribe');
          const executionBinding = resolveExecutionBinding({
            runtimeDefaults,
            bundle: state.bundle,
          });
          if (!executionBinding) {
            throw new Error('Foreground voice requires an explicit execution binding for reply continuity.');
          }
          return {
            available: true,
            reason: null,
          };
        } catch (error) {
          return {
            available: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      };

      startVoiceCapture = async (input) => {
        if (cleanedUp) {
          throw new Error('Foreground voice is unavailable after shutdown');
        }
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || state.auth.status !== 'authenticated') {
          throw new Error('Foreground voice requires active runtime auth');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
        const availability = await getVoiceInputAvailability(input);
        if (!availability.available) {
          throw new Error(availability.reason || 'Foreground voice is unavailable for the current anchor.');
        }
        return startAvatarVoiceCaptureSession({
          onLevelChange: input.onLevelChange,
        });
      };

      submitVoiceCaptureTurn = async (input) => {
        if (!(input.audioBytes instanceof Uint8Array) || input.audioBytes.length === 0) {
          throw new Error('Foreground voice requires recorded audio bytes.');
        }
        const mimeType = readNormalizedString(input.mimeType);
        if (!mimeType) {
          throw new Error('Foreground voice requires an audio mimeType.');
        }
        if (cleanedUp) {
          throw new Error('Foreground voice is unavailable after shutdown');
        }
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || state.auth.status !== 'authenticated') {
          throw new Error('Foreground voice requires active runtime auth');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
        const transcribeBinding = await resolveCapabilityBinding(runtime, 'audio.transcribe');
        const transcriptResult = await runtime.media.stt.transcribe({
          model: transcribeBinding.modelId,
          audio: {
            kind: 'bytes',
            bytes: input.audioBytes,
          },
          mimeType,
          ...(readNormalizedString(input.language) ? { language: readNormalizedString(input.language) } : {}),
          route: transcribeBinding.route,
          ...(transcribeBinding.connectorId ? { connectorId: transcribeBinding.connectorId } : {}),
          signal: input.signal,
        });
        const transcript = readNormalizedString(transcriptResult.text);
        if (!transcript) {
          throw new Error('Foreground voice transcription returned no transcript text.');
        }
        if (input.signal?.aborted) {
          throw createAbortError('Foreground voice request aborted before reply submission.');
        }
        const currentState = useAvatarStore.getState();
        if (currentState.consume.authority !== 'runtime' || currentState.auth.status !== 'authenticated') {
          throw new Error('Foreground voice requires active runtime auth');
        }
        if (
          currentState.consume.agentId !== input.agentId
          || currentState.consume.conversationAnchorId !== input.conversationAnchorId
        ) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
        const executionBinding = resolveExecutionBinding({
          runtimeDefaults,
          bundle: currentState.bundle,
        });
        if (!executionBinding) {
          throw new Error('Foreground voice requires an explicit execution binding for reply continuity.');
        }
        await runtime.agent.turns.request({
          agentId: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
          worldId,
          messages: [{ role: 'user', content: transcript }],
          executionBinding,
        });
        return { transcript };
      };

      interruptTurn = async (input) => {
        if (cleanedUp) {
          throw new Error('Foreground voice is unavailable after shutdown');
        }
        const state = useAvatarStore.getState();
        if (state.consume.authority !== 'runtime' || state.auth.status !== 'authenticated') {
          throw new Error('Foreground voice requires active runtime auth');
        }
        if (input.agentId !== agentId || input.conversationAnchorId !== conversationAnchorId) {
          throw new Error('Foreground voice requires the current explicit agent and anchor binding');
        }
        await runtime.agent.turns.interrupt({
          agentId: input.agentId,
          conversationAnchorId: input.conversationAnchorId,
          ...(readNormalizedString(input.turnId) ? { turnId: readNormalizedString(input.turnId) } : {}),
          ...(readNormalizedString(input.reason) ? { reason: readNormalizedString(input.reason) } : {}),
        });
      };
    }

    unsubscribeStatus = driver.onStatusChange((status) => {
      useAvatarStore.getState().setDriverStatus(status);
    });

    unsubscribeBundle = driver.onBundleChange((bundle) => {
      useAvatarStore.getState().setBundle(bundle);
    });

    await driver.start();

    return {
      driver,
      carrier,
      getVoiceInputAvailability,
      startVoiceCapture,
      submitVoiceCaptureTurn,
      interruptTurn,
      requestTextTurn,
      async shutdown() {
        await cleanup();
      },
    };
  } catch (error) {
    const errorRecord = error as {
      message?: unknown;
      name?: unknown;
      stack?: unknown;
      reasonCode?: unknown;
      actionHint?: unknown;
      source?: unknown;
      retryable?: unknown;
      cause?: unknown;
    };
    recordAvatarEvidenceEventually({
      kind: 'avatar.startup.failed',
      detail: {
        error: error instanceof Error ? error.message : String(error || 'unknown avatar startup failure'),
        error_name: error instanceof Error ? error.name : null,
        error_reason_code: typeof errorRecord.reasonCode === 'string' ? errorRecord.reasonCode : null,
        error_action_hint: typeof errorRecord.actionHint === 'string' ? errorRecord.actionHint : null,
        error_source: typeof errorRecord.source === 'string' ? errorRecord.source : null,
        error_retryable: typeof errorRecord.retryable === 'boolean' ? errorRecord.retryable : null,
        error_stack: typeof errorRecord.stack === 'string' ? errorRecord.stack.slice(0, 2_000) : null,
        error_cause: errorRecord.cause ? String(errorRecord.cause).slice(0, 1_000) : null,
        auth_resolution: authResolutionEvidence,
      },
    });
    await cleanup();
    throw error;
  }
}
