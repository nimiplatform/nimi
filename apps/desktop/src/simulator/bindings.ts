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
  let currentRoute = context.route.get();
  const routeListeners = new Set<() => void>();
  const unsubscribeRoute = context.route.subscribe((route) => {
    currentRoute = route;
    for (const listener of routeListeners) listener();
  });
  const cleanup = context.cleanup.add(() => {
    routeListeners.clear();
    unsubscribeRoute();
  });
  if (!cleanup.ok) throw new Error('DESKTOP_SIMULATOR_ROUTE_CLEANUP_REJECTED');

  return createNimiCanonicalRendererHostBindings({
    scope: context.kit.scope,
    capabilities: context.kit.capabilities,
    localization: context.kit.localization,
    kit: context.kit,
    sdk: Object.freeze({}),
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
      }),
      commands: Object.freeze({
        commitAIConfig() {
          throw new Error('DESKTOP_SIMULATOR_AI_CONFIG_UNADMITTED');
        },
        persistChatThinkingPreference() {
          throw new Error('DESKTOP_SIMULATOR_CHAT_PREFERENCE_UNADMITTED');
        },
        setActiveScopeForMode() {
          throw new Error('DESKTOP_SIMULATOR_CHAT_MODE_UNADMITTED');
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
        async decideLocalDevelopmentApproval() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
      }),
      events: Object.freeze({
        subscribeAttention: () => () => undefined,
        async subscribeLocalDevelopmentApprovals() {
          throw new Error('DESKTOP_SIMULATOR_LOCAL_DEVELOPMENT_UNADMITTED');
        },
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
    clock: context.clock,
    surfaceLifecycle: context.kit.surfaceLifecycle,
  });
}
