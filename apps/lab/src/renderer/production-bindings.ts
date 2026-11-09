import { createStudioPromptDraftRepository } from '../ai-studio-core/prompt-drafts.js';
import { createNimiClientId } from '@nimiplatform/sdk';
import { requestWithRetry } from '@nimiplatform/sdk/types';
import type { Realm } from '@nimiplatform/sdk/realm';
import {
  loadNimiRealmCreatorEligibility,
  loadNimiRealmNotificationUnreadCount,
  loadNimiRealmNotifications,
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
import { requireLabNativeClient, getLabLocalAppClient, isLabRemoteRuntime } from '../shell/local-app-runtime-platform.js';
import { downloadLabWebAsset, requestLabWebDownload } from '../web/download.js';
import { listLabVoiceAssets } from '../ai-studio-core/voice-assets.js';
import { loadLabAIConfigSummary } from '../lab/lab-ai-config.js';
import { runLabConversationJourney } from '../lab/local-app-conversation-journey.js';
import { saveLabExport } from '../lab/lab-export.js';
import { appendLabRunHistory, clearLabRunHistory, loadLabRunHistory, removeLabRunHistoryRecord } from '../lab/lab-history-storage.js';
import { appendLabIntegrationHistory, loadLabIntegrationHistory, removeLabIntegrationHistory } from '../lab/integrations/integration-history.js';
import {
  appendLabImageHistoryRecord,
  clearLabImageHistory,
  loadLabImageHistory,
  removeLabImageHistoryRecord,
} from '../lab/lab-image-history.js';
import {
  loadLabPreferences,
  saveLabPreferences,
} from '../lab/lab-preferences.js';
import { resumeWorldTour, runWorldTour } from '../lab/world-tour/world-tour-runtime.js';
import {
  claimWorldTourViewerLaunch,
  openWorldTourWindow,
  resolveWorldTourFixture,
  saveWorldTourViewerPreset,
} from '../lab/world-tour/world-tour-shared.js';
import type {
  LabCanonicalRendererBindings,
  LabRendererCommandPort,
  LabRendererRoutePort,
  LabRendererRouteView,
  LabRendererSdkPort,
} from './contract.js';

function productionRoutePort(): LabRendererRoutePort {
  function readCurrent(): LabRendererRouteView {
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
  });
}

function hostSuccess<TValue>(value: TValue): NimiRendererHostResult<TValue> {
  return { ok: true, value };
}

function hostFailure<TValue>(
  disposition: 'unsupported' | 'host-unavailable' | 'internal',
): NimiRendererHostResult<TValue> {
  return { ok: false, error: { disposition } };
}

async function requireLabRealm(): Promise<Realm> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') throw new Error(projection.message);
  throw new Error('Realm is not admitted by the local-app carrier.');
}

export function createLabProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
): LabCanonicalRendererBindings {
  const labLocalAppClient = getLabLocalAppClient();
  const promptDrafts = createStudioPromptDraftRepository(labLocalAppClient.storage);
  const bindings = createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: kit.localization,
    kit,
    sdk: Object.freeze({
      localAppClient: labLocalAppClient,
      runCapability: async (input: Parameters<LabRendererSdkPort['runCapability']>[0]) => input.capabilityId === 'world.generate'
        ? runWorldTour(input)
        : (await import('../lab/lab-runtime.js')).runLabCapability(input),
      deleteLocalAppVoiceAsset: (voiceAssetId: string) => labLocalAppClient.ai.voiceAssets.delete(voiceAssetId),
      async listLocalAppVoiceAssets() {
        return listLabVoiceAssets(labLocalAppClient.ai.voiceAssets);
      },
      uploadLocalAppArtifact: (input: Parameters<LabRendererSdkPort['uploadLocalAppArtifact']>[0]) => labLocalAppClient.ai.artifacts.upload(input),
      aiConfig: labLocalAppClient.aiConfig,
      storage: Object.freeze({ assets: labLocalAppClient.storage.assets }),
      settings: Object.freeze({
        notificationUnread: async () => loadNimiRealmNotificationUnreadCount(await requireLabRealm()),
        async notifications() {
          const list = await loadNimiRealmNotifications(await requireLabRealm(), {
            limit: 5,
            unreadOnly: false,
            type: getNimiNotificationServerFilter('system') ?? undefined,
          });
          return toNimiRealmNotificationListView(list, 'Lab notification', 'Unknown actor');
        },
        creatorEligibility: async () => loadNimiRealmCreatorEligibility(await requireLabRealm()),
        async humanChats() {
          const realm = await requireLabRealm();
          return listRealmChats(20, undefined, createRealmChatService(realm.humanChats));
        },
      }),
    }),
    app: {
      projection: Object.freeze({
        runtimePlatform: getRuntimePlatformProjection,
        aiConfigSummary: loadLabAIConfigSummary,
        runHistory: () => requestWithRetry({
          executor: () => loadLabRunHistory(labLocalAppClient.storage.assets),
          options: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 50 },
        }),
        integrationHistory: () => loadLabIntegrationHistory(labLocalAppClient.storage.assets),
        imageHistory: () => requestWithRetry({
          executor: () => loadLabImageHistory(labLocalAppClient.storage.assets),
          options: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 50 },
        }),
        ecosystemReference: () => null,
        personaReference: () => null,
        preferences: () => loadLabPreferences().preferences,
        promptDraft: promptDrafts.load,
      }),
      commands: Object.freeze({
        async nextRunIdentity() {
          return { runId: createNimiClientId('run'), createdAt: new Date().toISOString() };
        },
        appendRunHistory: (input: Parameters<LabRendererCommandPort['appendRunHistory']>[0]) => appendLabRunHistory(input, labLocalAppClient.storage.assets),
        appendIntegrationHistory: (input: Parameters<LabRendererCommandPort['appendIntegrationHistory']>[0]) => appendLabIntegrationHistory(input, labLocalAppClient.storage.assets),
        removeIntegrationHistory: (input: Parameters<LabRendererCommandPort['removeIntegrationHistory']>[0]) => removeLabIntegrationHistory(input, labLocalAppClient.storage.assets),
        removeRunHistory: (input: Parameters<LabRendererCommandPort['removeRunHistory']>[0]) => removeLabRunHistoryRecord(input, labLocalAppClient.storage.assets),
        async clearRunHistory(input: { readonly capabilityId?: string }) {
          return clearLabRunHistory(input.capabilityId, labLocalAppClient.storage.assets);
        },
        appendImageHistory: (input: Parameters<LabRendererCommandPort['appendImageHistory']>[0]) => appendLabImageHistoryRecord(input, labLocalAppClient.storage.assets),
        removeImageHistory: (input: Parameters<LabRendererCommandPort['removeImageHistory']>[0]) => removeLabImageHistoryRecord(input, labLocalAppClient.storage.assets),
        async clearImageHistory(input: { readonly capabilityId?: string }) {
          return clearLabImageHistory(input.capabilityId, labLocalAppClient.storage.assets);
        },
        async savePreferences(preferences: Parameters<LabRendererCommandPort['savePreferences']>[0]) {
          const result = saveLabPreferences(preferences);
          if (result.status.state === 'write-error' || result.status.state === 'unavailable') {
            throw new Error(result.status.error || result.status.message);
          }
        },
        savePromptDraft: promptDrafts.save,
        async copyText(text: string) {
          if (!navigator.clipboard) return hostFailure<{ readonly copied: boolean }>('unsupported');
          try {
            await navigator.clipboard.writeText(text);
            return hostSuccess({ copied: true });
          } catch {
            return hostFailure<{ readonly copied: boolean }>('host-unavailable');
          }
        },
        async exportText(input: { readonly filename: string; readonly body: string }): ReturnType<LabRendererCommandPort['exportText']> {
          try {
            if (isLabRemoteRuntime()) {
              return { ok: true, value: requestLabWebDownload(input.filename, new Blob([input.body], { type: 'text/plain' })) };
            }
            const saved = await saveLabExport({
              filename: input.filename,
              mimeType: 'text/plain',
              body: input.body,
            });
            return { ok: true, value: { destination: 'runtime-asset', filename: saved.filename, artifactPath: saved.artifactPath,
              byteSize: saved.byteSize, revealed: saved.revealed } };
          } catch {
            return { ok: false, error: { disposition: 'host-unavailable' } };
          }
        },
        async exportAsset(relativePath: string) {
          if (isLabRemoteRuntime()) { await downloadLabWebAsset(labLocalAppClient.storage.assets, relativePath); }
          else { await requireLabNativeClient(labLocalAppClient).storage.assets.reveal(relativePath); }
        },
        resolveWorldTourFixture,
        openWorldTourWindow,
        resumeWorldTour,
        claimWorldTourViewerLaunch,
        saveWorldTourViewerPreset,
        async localAppSessionStatus() {
          const status = await getRuntimePlatformProjection();
          if (status.status === 'ready' && status.mode === 'remote-app') return { state: 'connected', sessionBound: true };
          if (status.status === 'ready') return { state: status.localAppSession.state, sessionBound: status.localAppSession.sessionBound };
          return { state: status.status, sessionBound: false };
        },
        async localAppConversationJourney(input: Parameters<LabRendererCommandPort['localAppConversationJourney']>[0]) {
          return runLabConversationJourney({
            conversation: labLocalAppClient.conversation,
            agentHandle: input.agentHandle,
            requestId: createNimiClientId('lab-turn'),
            text: input.text,
          });
        },
        async localAppConversationSnapshot(input: Parameters<LabRendererCommandPort['localAppConversationSnapshot']>[0]) {
          return labLocalAppClient.conversation.snapshot(input);
        },
        async localAppStorageRoundTrip(input: { readonly relativePath: string; readonly value: Readonly<Record<string, string | number>> }) {
          const written = await labLocalAppClient.storage.writeJson(input.relativePath, input.value);
          const read = await labLocalAppClient.storage.readJson(input.relativePath);
          if (!jsonValuesEqual(read.value, input.value)) {
            throw new Error('App-private storage readback did not match the written value.');
          }
          const removed = await labLocalAppClient.storage.removeJson(input.relativePath);
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
  return bindings as LabCanonicalRendererBindings;
}
