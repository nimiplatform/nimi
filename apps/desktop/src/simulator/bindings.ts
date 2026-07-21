import { createNimiCanonicalRendererHostBindings } from '@nimiplatform/kit/shell/renderer/host';
import {
  createEmptyNimiAIConfig,
  createNimiBuiltInChatAIScopeRef,
} from '@nimiplatform/sdk/ai';

import { createIdleAppAttentionState } from '../shell/renderer/app-shell/providers/app-attention-state.js';
import type {
  DesktopCanonicalRendererBindings,
  DesktopRendererRouteView,
} from '../shell/renderer/renderer/contract.js';
import type {
  DesktopSimulatorJsonValue,
  DesktopSimulatorPrepareContext,
  DesktopSimulatorRouteState,
} from './protocol.js';
import { createUnavailableDesktopFirstRunPort } from '../shell/renderer/renderer/first-run-port.js';
import { createMemoryDesktopRendererSettingsPort } from '../shell/renderer/renderer/settings-port.js';
import { createUnavailableDesktopRendererAuthPort } from '../shell/renderer/renderer/auth-port.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from '../shell/renderer/renderer/runtime-config-navigation-port.js';
import { createUnavailableDesktopRendererProfileLibraryPort } from '../shell/renderer/renderer/profile-library-port.js';
import { createUnavailableDesktopRendererOfflinePort } from '../shell/renderer/renderer/offline-port.js';
import { createUnavailableDesktopRendererWorldFollowPort } from '../shell/renderer/renderer/world-follow-port.js';
import { createUnavailableDesktopRendererSupportRepairPort } from '../shell/renderer/renderer/support-repair-port.js';
import { createUnavailableDesktopRendererSystemResourcesPort } from '../shell/renderer/renderer/system-resources-port.js';
import { createUnavailableDesktopRendererVoiceCapturePort } from '../shell/renderer/renderer/voice-capture-port.js';
import { createUnavailableDesktopRendererSupportLogsPort } from '../shell/renderer/renderer/support-logs-port.js';
import { createMemoryDesktopRendererLocalModelProgressPort } from '../shell/renderer/renderer/local-model-progress-port.js';
import { createUnavailableDesktopRendererAvatarHandoffPort } from '../shell/renderer/renderer/avatar-handoff-port.js';
import { createDeterministicDesktopVirtualizationPort } from '../shell/renderer/renderer/virtualization-port.js';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

function record(value: DesktopSimulatorJsonValue, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function projection(context: DesktopSimulatorPrepareContext): JsonRecord {
  return record(context.projection.get(), 'PROJECTION');
}

function simulatorSdkUnadmitted(): never {
  throw new Error('DESKTOP_SIMULATOR_SDK_UNADMITTED');
}

function toRendererRoute(route: DesktopSimulatorRouteState): DesktopRendererRouteView {
  const search = new URLSearchParams(route.search.map(({ key, value }) => [key, value])).toString();
  return Object.freeze({
    pathname: route.pathname,
    search: search ? `?${search}` : '',
    hash: route.fragment ? `#${route.fragment}` : '',
    state: null,
    key: `${route.pathname}?${search}#${route.fragment || ''}`,
  });
}

export function createDesktopSimulatorBindings(
  context: DesktopSimulatorPrepareContext,
): DesktopCanonicalRendererBindings {
  type TimerEntry = {
    cancelled: boolean;
    jobId: string | null;
    readonly listener: Parameters<DesktopCanonicalRendererBindings['clock']['schedule']>[1];
  };
  let currentRoute = context.route.get();
  let timerSequence = 0;
  const routeListeners = new Set<() => void>();
  const timers = new Map<string, TimerEntry>();
  const unsubscribeRoute = context.route.subscribe((route) => {
    currentRoute = route;
    for (const listener of routeListeners) listener();
  });
  const cleanup = context.cleanup.add(() => {
    routeListeners.clear();
    unsubscribeRoute();
  });
  if (!cleanup.ok) throw new Error('DESKTOP_SIMULATOR_ROUTE_CLEANUP_REJECTED');
  const timerEvents = context.events.subscribe('desktop.renderer.timer.fired', (value) => {
    const payload = record(value, 'TIMER_EVENT');
    if (typeof payload.token !== 'string') throw new Error('DESKTOP_SIMULATOR_TIMER_EVENT_INVALID');
    const entry = timers.get(payload.token);
    if (!entry || entry.cancelled) return;
    timers.delete(payload.token);
    entry.listener({ ok: true });
  });
  if (!timerEvents.ok) throw new Error(`DESKTOP_SIMULATOR_TIMER_EVENT_REJECTED:${timerEvents.error.code}`);
  const timerCleanup = context.cleanup.add(async () => {
    timerEvents.value();
    const pending = [...timers.values()];
    for (const entry of pending) entry.cancelled = true;
    timers.clear();
    await Promise.all(pending.flatMap((entry) => entry.jobId
      ? [context.clock.cancel(entry.jobId)]
      : []));
  });
  if (!timerCleanup.ok) throw new Error('DESKTOP_SIMULATOR_TIMER_CLEANUP_REJECTED');

  const scheduleRendererTimer: DesktopCanonicalRendererBindings['clock']['schedule'] = (delayMs, listener) => {
    timerSequence += 1;
    const token = `${context.instanceId}:timer:${timerSequence}`;
    const entry: TimerEntry = { cancelled: false, jobId: null, listener };
    timers.set(token, entry);
    void context.clock.schedule({
      type: 'desktop.renderer.timer.fire',
      payload: { token },
      causationId: null,
    }, delayMs).then((result) => {
      if (!result.ok) {
        if (timers.delete(token) && !entry.cancelled) {
          listener({ ok: false, error: result.error.code });
        }
        return;
      }
      const scheduled = record(result.value, 'TIMER_SCHEDULE_RESULT');
      if (typeof scheduled.jobId !== 'string') {
        if (timers.delete(token) && !entry.cancelled) {
          listener({ ok: false, error: 'DESKTOP_SIMULATOR_TIMER_JOB_INVALID' });
        }
        return;
      }
      entry.jobId = scheduled.jobId;
      if (entry.cancelled) void context.clock.cancel(scheduled.jobId);
    });
    return () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      timers.delete(token);
      if (entry.jobId) void context.clock.cancel(entry.jobId);
    };
  };

  return createNimiCanonicalRendererHostBindings({
    scope: context.kit.scope,
    capabilities: context.kit.capabilities,
    localization: context.kit.localization,
    kit: context.kit,
    sdk: Object.freeze({
      isSessionReady: () => false,
      isRuntimeAccountSessionReady: () => false,
      appId: simulatorSdkUnadmitted,
      client: simulatorSdkUnadmitted,
      runtime: simulatorSdkUnadmitted,
      runtimeAgentTurns: simulatorSdkUnadmitted,
      hostRuntimeAgent: simulatorSdkUnadmitted,
      accountRuntime: simulatorSdkUnadmitted,
      runtimeRouteAccess: simulatorSdkUnadmitted,
      loadRouteOptions: simulatorSdkUnadmitted,
      conversationCapabilityRuntime: () => null,
      runtimeHealthCoordinator: simulatorSdkUnadmitted,
      aiConfig: simulatorSdkUnadmitted,
      realm: simulatorSdkUnadmitted,
      offline: createUnavailableDesktopRendererOfflinePort('DESKTOP_SIMULATOR_OFFLINE_UNADMITTED'),
      socialData: Object.freeze({
        callApi: async () => simulatorSdkUnadmitted(),
        emitDataError: () => undefined,
        offline: Object.freeze({
          async syncProfileMetadata() {
            throw new Error('DESKTOP_SIMULATOR_SOCIAL_OFFLINE_UNADMITTED');
          },
          async loadProfileMetadata() {
            return null;
          },
          markCacheFallbackUsed() {
            throw new Error('DESKTOP_SIMULATOR_SOCIAL_OFFLINE_UNADMITTED');
          },
          markRealmUnreachable() {
            throw new Error('DESKTOP_SIMULATOR_SOCIAL_OFFLINE_UNADMITTED');
          },
          async queueSocialMutation() {
            throw new Error('DESKTOP_SIMULATOR_SOCIAL_OFFLINE_UNADMITTED');
          },
        }),
      }),
      accountCaller: simulatorSdkUnadmitted,
      withRuntimeProtectedScopes: async () => simulatorSdkUnadmitted(),
    }),
    app: {
      projection: Object.freeze({
        initialState: () => ({
          aiConfig: createEmptyNimiAIConfig(createNimiBuiltInChatAIScopeRef('nimi')),
          bootstrapError: null,
          bootstrapReady: true,
          chatThinkingPreference: 'off' as const,
          development: false,
        }),
        attention: createIdleAppAttentionState,
        localDevelopmentAvailable: () => false,
        loginMode: () => 'embedded',
        developerModeEnabled: () => false,
        viewportWidth: () => 1_280,
        documentVisible: () => true,
        windowFocused: () => true,
        resourceBaseUrl: () => 'https://simulator.invalid/',
        walletCheckoutBaseUrl: () => 'https://simulator.invalid/',
      }),
      commands: Object.freeze({
        auth: createUnavailableDesktopRendererAuthPort(),
        firstRun: createUnavailableDesktopFirstRunPort('DESKTOP_SIMULATOR_FIRST_RUN_UNADMITTED'),
        runtimeConfigNavigation: createDesktopRendererRuntimeConfigNavigationPort(),
        settings: createMemoryDesktopRendererSettingsPort(),
        profileLibrary: createUnavailableDesktopRendererProfileLibraryPort(),
        worldFollow: createUnavailableDesktopRendererWorldFollowPort(
          'DESKTOP_SIMULATOR_WORLD_FOLLOW_UNADMITTED',
        ),
        localModelProgress: createMemoryDesktopRendererLocalModelProgressPort(),
        virtualization: createDeterministicDesktopVirtualizationPort(),
        avatarHandoff: createUnavailableDesktopRendererAvatarHandoffPort(
          'DESKTOP_SIMULATOR_AVATAR_HANDOFF_UNADMITTED',
        ),
        voiceCapture: createUnavailableDesktopRendererVoiceCapturePort(
          'DESKTOP_SIMULATOR_VOICE_CAPTURE_UNADMITTED',
        ),
        systemResources: createUnavailableDesktopRendererSystemResourcesPort(
          'DESKTOP_SIMULATOR_SYSTEM_RESOURCES_UNADMITTED',
        ),
        supportLogs: createUnavailableDesktopRendererSupportLogsPort(
          'DESKTOP_SIMULATOR_SUPPORT_LOGS_UNADMITTED',
        ),
        supportRepair: createUnavailableDesktopRendererSupportRepairPort(
          'DESKTOP_SIMULATOR_SUPPORT_REPAIR_UNADMITTED',
        ),
        connectorAuth: Object.freeze({
          async proxyHttp() {
            throw new Error('DESKTOP_SIMULATOR_CONNECTOR_AUTH_UNADMITTED');
          },
          async oauthTokenExchange() {
            throw new Error('DESKTOP_SIMULATOR_CONNECTOR_AUTH_UNADMITTED');
          },
        }),
        runtimeDaemon: Object.freeze({
          available: () => false,
          async status() { throw new Error('DESKTOP_SIMULATOR_RUNTIME_DAEMON_UNADMITTED'); },
          async start() { throw new Error('DESKTOP_SIMULATOR_RUNTIME_DAEMON_UNADMITTED'); },
          async restart() { throw new Error('DESKTOP_SIMULATOR_RUNTIME_DAEMON_UNADMITTED'); },
        }),
        commitAIConfig() {
          throw new Error('DESKTOP_SIMULATOR_AI_CONFIG_UNADMITTED');
        },
        persistChatThinkingPreference() {
          throw new Error('DESKTOP_SIMULATOR_CHAT_PREFERENCE_UNADMITTED');
        },
        async reconcileLoginState() {
          return Object.freeze({ clearAuthSession: false });
        },
        setActiveScopeForMode() {
          throw new Error('DESKTOP_SIMULATOR_CHAT_MODE_UNADMITTED');
        },
        setGroupLocalAgentParticipationActive() {
          throw new Error('DESKTOP_SIMULATOR_GROUP_LOCAL_AGENT_UNADMITTED');
        },
        async applyLocale(input: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['applyLocale']
        >[0]) {
          const result = await context.commands.invoke('desktop.locale.apply', {
            locale: input.locale,
            lang: input.lang,
            title: input.title,
          });
          if (!result.ok) throw new Error(`DESKTOP_SIMULATOR_LOCALE_REJECTED:${result.error.code}`);
        },
        async openWalletCheckout() {
          throw new Error('DESKTOP_SIMULATOR_WALLET_CHECKOUT_UNADMITTED');
        },
        async writeClipboardText() {
          throw new Error('DESKTOP_SIMULATOR_CLIPBOARD_WRITE_UNADMITTED');
        },
        exportProfileLibraryJson() {
          throw new Error('DESKTOP_SIMULATOR_PROFILE_EXPORT_UNADMITTED');
        },
        exportRuntimeAuditJson() {
          throw new Error('DESKTOP_SIMULATOR_RUNTIME_AUDIT_EXPORT_UNADMITTED');
        },
        confirmRuntimeProfileInstall() {
          throw new Error('DESKTOP_SIMULATOR_RUNTIME_PROFILE_INSTALL_UNADMITTED');
        },
        async pickLocalRuntimeAssetManifestPath() {
          throw new Error('DESKTOP_SIMULATOR_RUNTIME_ASSET_PICKER_UNADMITTED');
        },
        async pickLocalRuntimeAssetFile() {
          throw new Error('DESKTOP_SIMULATOR_RUNTIME_ASSET_PICKER_UNADMITTED');
        },
        async pickLocalRuntimeAssetDirectory() {
          throw new Error('DESKTOP_SIMULATOR_RUNTIME_ASSET_PICKER_UNADMITTED');
        },
        async revealLocalRuntimeAssetsRootFolder() {
          throw new Error('DESKTOP_SIMULATOR_RUNTIME_ASSET_REVEAL_UNADMITTED');
        },
        async checkDesktopUpdate() {
          throw new Error('DESKTOP_SIMULATOR_UPDATE_UNADMITTED');
        },
        async installDesktopUpdate() {
          throw new Error('DESKTOP_SIMULATOR_UPDATE_UNADMITTED');
        },
        async restartDesktopUpdate() {
          throw new Error('DESKTOP_SIMULATOR_UPDATE_UNADMITTED');
        },
        async startWindowDrag() {
          throw new Error('DESKTOP_SIMULATOR_WINDOW_DRAG_UNADMITTED');
        },
        async listLocalDevelopmentApprovals() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
        async listLocalDevelopmentAuthorizations() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
        async listLocalDevelopmentRuns() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
        async revokeLocalDevelopmentAuthorization() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
        async decideLocalDevelopmentApproval() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
        async refreshDeveloperMode() {
          throw new Error('DESKTOP_SIMULATOR_DEVELOPER_MODE_UNADMITTED');
        },
        async setDeveloperMode() {
          throw new Error('DESKTOP_SIMULATOR_DEVELOPER_MODE_UNADMITTED');
        },
      }),
      events: Object.freeze({
        connectChatRealtimeSync: () => () => undefined,
        subscribeWindowFocus: () => () => undefined,
        subscribeDocumentVisibility: () => () => undefined,
        subscribeWindowResize: () => () => undefined,
        subscribeWindowKeyDown: () => () => undefined,
        subscribeDocumentMouseDown: () => () => undefined,
        subscribeDocumentClick: () => () => undefined,
        subscribeDocumentPointerDown: () => () => undefined,
        observeIntersection: () => () => undefined,
        subscribeAttention: () => () => undefined,
        subscribeDeveloperMode: () => () => undefined,
        async subscribeLocalDevelopmentApprovals() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
        subscribeProductControlRecord(listener: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['subscribeProductControlRecord']
        >[0]) {
          listener({ ok: false, error: 'DESKTOP_SIMULATOR_PRODUCT_CONTROL_UNADMITTED' });
          return () => undefined;
        },
        connectDesktopOpenIntents: () => () => undefined,
        connectLifecycle(lifecycle: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['connectLifecycle']
        >[0]) {
          const apply = () => {
            const current = projection(context);
            if (typeof current.bootstrapReady !== 'boolean') {
              throw new Error('DESKTOP_SIMULATOR_BOOTSTRAP_PROJECTION_INVALID');
            }
            lifecycle.setBootstrapError(null);
            lifecycle.setBootstrapReady(current.bootstrapReady);
          };
          apply();
          return context.projection.subscribe(apply);
        },
      }),
    },
    route: Object.freeze({
      get: () => toRendererRoute(currentRoute),
      subscribe(listener: () => void) {
        routeListeners.add(listener);
        return () => routeListeners.delete(listener);
      },
      async navigate(input: { readonly to: string; readonly replace: boolean; readonly state?: unknown }) {
        if (input.state !== undefined && input.state !== null) {
          throw new Error('DESKTOP_SIMULATOR_ROUTE_STATE_UNADMITTED');
        }
        const next = new URL(input.to, 'https://simulator.invalid');
        const result = await context.route.navigate({
          pathname: next.pathname,
          search: [...next.searchParams].map(([key, value]) => ({ key, value })),
          fragment: next.hash ? next.hash.slice(1) : null,
        });
        if (!result.ok) throw new Error(`DESKTOP_SIMULATOR_ROUTE_REJECTED:${result.error.code}`);
      },
      go() {
        throw new Error('DESKTOP_SIMULATOR_HISTORY_DELTA_UNADMITTED');
      },
    }),
    clock: Object.freeze({
      now: context.clock.now,
      schedule: scheduleRendererTimer,
      animationFrame: (
        listener: Parameters<DesktopCanonicalRendererBindings['clock']['animationFrame']>[0],
      ) => scheduleRendererTimer(16, listener),
    }),
    surfaceLifecycle: context.kit.surfaceLifecycle,
  });
}
