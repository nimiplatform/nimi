import { createNimiClientId } from '@nimiplatform/sdk';
import type { NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk/ai';
import { requestWithRetry } from '@nimiplatform/sdk/types';
import type { Realm } from '@nimiplatform/sdk/realm';
import {
  listNimiRealmGroupChats,
  loadNimiRealmCreatorEligibility,
  loadNimiRealmNotificationUnreadCount,
  loadNimiRealmNotifications,
  requestNimiRealmDataExport,
  toNimiRealmNotificationListView,
} from '@nimiplatform/sdk/realm';
import { jsonValuesEqual } from '@nimiplatform/kit/core/json-value';
import { getNimiNotificationServerFilter } from '@nimiplatform/kit/core/notifications';
import { createRealmChatService, listRealmChats } from '@nimiplatform/kit/features/chat/realm';
import { emitRuntimeLog, logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
  type NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';

import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterLocalAppClient } from '../shell/local-app-runtime-platform.js';
import { loadTesterAIConfig, requireTesterAIConfigOwner } from '../tester/tester-ai-config-store.js';
import { loadTesterAIConfigSummary } from '../tester/tester-ai-config.js';
import { runTesterConversationJourney } from '../tester/local-app-conversation-journey.js';
import { saveTesterExport } from '../tester/tester-export.js';
import { appendTesterRunHistory, clearTesterRunHistory, loadTesterRunHistory, removeTesterRunHistoryRecord } from '../tester/tester-history-storage.js';
import { appendTesterImageHistoryRecord, loadTesterImageHistory } from '../tester/tester-image-history.js';
import {
  loadTesterPreferences,
  loadTesterPromptDraft,
  saveTesterPreferences,
  saveTesterPromptDraft,
} from '../tester/tester-preferences.js';
import { runTesterCapability } from '../tester/tester-runtime.js';
import {
  claimWorldTourViewerLaunch,
  openWorldTourWindow,
  resolveWorldTourFixture,
  saveWorldTourViewerPreset,
} from '../tester/world-tour/world-tour-shared.js';
import type {
  TesterCanonicalRendererBindings,
  TesterRendererCommandPort,
  TesterRendererRoutePort,
  TesterRendererRouteView,
  TesterRendererSdkPort,
} from './contract.js';

function productionRoutePort(): TesterRendererRoutePort {
  function readCurrent(): TesterRendererRouteView {
    const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const hashRoute = fragment.startsWith('/') ? new URL(fragment, window.location.origin) : null;
    const searchParams = hashRoute?.searchParams ?? new URLSearchParams(window.location.search);
    return {
      pathname: hashRoute?.pathname ?? window.location.pathname,
      search: [...searchParams].map(([key, value]) => ({ key, value })),
      fragment: null,
    };
  }
  let snapshot = readCurrent();
  return Object.freeze({
    get: () => snapshot,
    subscribe(listener: () => void) {
      const onRoute = () => {
        snapshot = readCurrent();
        listener();
      };
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('popstate', onRoute);
      return () => {
        window.removeEventListener('popstate', onRoute);
        window.removeEventListener('hashchange', onRoute);
      };
    },
    async navigate(next: TesterRendererRouteView) {
      const query = new URLSearchParams(next.search.map(({ key, value }) => [key, value])).toString();
      window.history.pushState(null, '', `#${next.pathname}${query ? `?${query}` : ''}${next.fragment ? `#${next.fragment}` : ''}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
  });
}

async function saveRemoteArtifact(filename: string, url: string): Promise<{ readonly filename: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Runtime artifact download failed (${response.status})`);
  const blob = await response.blob();
  const saved = await saveTesterExport({ filename, mimeType: blob.type || undefined, body: blob });
  return { filename: saved.filename };
}

function hostSuccess<TValue>(value: TValue): NimiRendererHostResult<TValue> {
  return { ok: true, value };
}

function hostFailure<TValue>(
  disposition: 'unsupported' | 'host-unavailable' | 'internal',
): NimiRendererHostResult<TValue> {
  return { ok: false, error: { disposition } };
}

async function requireTesterRealm(): Promise<Realm> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') throw new Error(projection.message);
  throw new Error('Realm is not admitted by the local-app carrier.');
}

export function createTesterProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
): TesterCanonicalRendererBindings {
  const testerLocalAppClient = getTesterLocalAppClient();
  const bindings = createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: kit.localization,
    kit,
    sdk: Object.freeze({
      runCapability: runTesterCapability,
      async listLocalAppVoiceAssets() {
        const result = await testerLocalAppClient.ai.voiceAssets.list({ pageSize: 100, pageToken: '' });
        return result.assets.map((asset) => ({
          voiceAssetId: asset.voiceAssetId,
          workflowType: asset.workflowType,
          status: asset.status,
        }));
      },
      uploadLocalAppArtifact: (input: Parameters<TesterRendererSdkPort['uploadLocalAppArtifact']>[0]) => testerLocalAppClient.ai.artifacts.upload(input),
      aiConfig: Object.freeze({
        get: () => loadTesterAIConfig(testerLocalAppClient.aiConfig),
        async overwrite(capabilities: readonly NimiPortableAppAIConfigIntent[]) {
          return requireTesterAIConfigOwner(
            await testerLocalAppClient.aiConfig.overwrite(capabilities),
          );
        },
      }),
      modelConfig: Object.freeze({
        localSelections: () => testerLocalAppClient.modelConfig.localSelections(),
      }),
      settings: Object.freeze({
        notificationUnread: async () => loadNimiRealmNotificationUnreadCount(await requireTesterRealm()),
        async notifications() {
          const list = await loadNimiRealmNotifications(await requireTesterRealm(), {
            limit: 5,
            unreadOnly: false,
            type: getNimiNotificationServerFilter('system') ?? undefined,
          });
          return toNimiRealmNotificationListView(list, 'Tester notification', 'Unknown actor');
        },
        requestDataExport: async () => requestNimiRealmDataExport(await requireTesterRealm(), {
          format: 'JSON',
          includeMedia: false,
          includeMessages: false,
          locale: 'en-US',
        }),
        creatorEligibility: async () => loadNimiRealmCreatorEligibility(await requireTesterRealm()),
        async humanChats() {
          const realm = await requireTesterRealm();
          return listRealmChats(20, undefined, createRealmChatService(realm.humanChats));
        },
        groupChats: async () => listNimiRealmGroupChats(await requireTesterRealm(), 20),
      }),
    }),
    app: {
      projection: Object.freeze({
        runtimePlatform: getRuntimePlatformProjection,
        aiConfigSummary: loadTesterAIConfigSummary,
        runHistory: () => requestWithRetry({
          executor: loadTesterRunHistory,
          options: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 50 },
        }),
        imageHistory: () => requestWithRetry({
          executor: loadTesterImageHistory,
          options: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 50 },
        }),
        ecosystemReference: () => null,
        personaReference: () => null,
        preferences: () => loadTesterPreferences().preferences,
        promptDraft: loadTesterPromptDraft,
      }),
      commands: Object.freeze({
        async nextRunIdentity() {
          return { runId: createNimiClientId('run'), createdAt: new Date().toISOString() };
        },
        appendRunHistory: appendTesterRunHistory,
        removeRunHistory: removeTesterRunHistoryRecord,
        async clearRunHistory(input: { readonly capabilityId?: string }) {
          return clearTesterRunHistory(input.capabilityId);
        },
        appendImageHistory: appendTesterImageHistoryRecord,
        async savePreferences(preferences: Parameters<TesterRendererCommandPort['savePreferences']>[0]) {
          const result = saveTesterPreferences(preferences);
          if (result.status.state === 'write-error' || result.status.state === 'unavailable') {
            throw new Error(result.status.error || result.status.message);
          }
        },
        async savePromptDraft(
          key: Parameters<TesterRendererCommandPort['savePromptDraft']>[0],
          prompt: string,
          enabled: boolean,
        ) {
          return saveTesterPromptDraft(key, prompt, enabled);
        },
        async copyText(text: string) {
          if (!navigator.clipboard) return hostFailure<{ readonly copied: boolean }>('unsupported');
          try {
            await navigator.clipboard.writeText(text);
            return hostSuccess({ copied: true });
          } catch {
            return hostFailure<{ readonly copied: boolean }>('host-unavailable');
          }
        },
        async exportText(input: { readonly filename: string; readonly body: string }) {
          try {
            const saved = await saveTesterExport({
              filename: input.filename,
              mimeType: 'text/plain;charset=utf-8',
              body: input.body,
            });
            return hostSuccess({ filename: saved.filename });
          } catch {
            return hostFailure<{ readonly filename: string }>('host-unavailable');
          }
        },
        async exportArtifact(input: { readonly filename: string; readonly url: string }) {
          try {
            return hostSuccess(await saveRemoteArtifact(input.filename, input.url));
          } catch {
            return hostFailure<{ readonly filename: string }>('host-unavailable');
          }
        },
        resolveWorldTourFixture,
        openWorldTourWindow,
        claimWorldTourViewerLaunch,
        saveWorldTourViewerPreset,
        async localAppSessionStatus() {
          const status = await testerLocalAppClient.auth.status();
          return { state: status.state, sessionBound: status.sessionBound };
        },
        async localAppConversationJourney(input: Parameters<TesterRendererCommandPort['localAppConversationJourney']>[0]) {
          return runTesterConversationJourney({
            conversation: testerLocalAppClient.conversation,
            agentHandle: input.agentHandle,
            requestId: createNimiClientId('tester-turn'),
            text: input.text,
          });
        },
        async localAppConversationSnapshot(input: Parameters<TesterRendererCommandPort['localAppConversationSnapshot']>[0]) {
          return testerLocalAppClient.conversation.snapshot(input);
        },
        async localAppStorageRoundTrip(input: { readonly relativePath: string; readonly value: Readonly<Record<string, string | number>> }) {
          const written = await testerLocalAppClient.storage.writeJson(input.relativePath, input.value);
          const read = await testerLocalAppClient.storage.readJson(input.relativePath);
          if (!jsonValuesEqual(read.value, input.value)) {
            throw new Error('App-private storage readback did not match the written value.');
          }
          const removed = await testerLocalAppClient.storage.removeJson(input.relativePath);
          return { sizeBytes: written.sizeBytes, removed: removed.removed };
        },
        async runtimeLog(input: Readonly<Record<string, unknown>>) {
          try {
            emitRuntimeLog(input as Parameters<typeof emitRuntimeLog>[0]);
            return hostSuccess({ recorded: true });
          } catch {
            return hostFailure<{ readonly recorded: boolean }>('internal');
          }
        },
        async rendererLog(input: Readonly<Record<string, unknown>>) {
          try {
            logRendererEvent(input as Parameters<typeof logRendererEvent>[0]);
            return hostSuccess({ recorded: true });
          } catch {
            return hostFailure<{ readonly recorded: boolean }>('internal');
          }
        },
      }),
      events: Object.freeze({
        subscribe() {
          return () => undefined;
        },
      }),
    },
    route: productionRoutePort(),
    clock: Object.freeze({ now: () => Date.now() }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
  return bindings as TesterCanonicalRendererBindings;
}
