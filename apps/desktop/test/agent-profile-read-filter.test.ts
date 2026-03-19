import assert from 'node:assert/strict';
import test from 'node:test';

import { createHookClient } from '@nimiplatform/sdk/mod';
import { loadAgentDetails } from '../src/runtime/data-sync/flows/agent-runtime-flow';
import {
  clearInternalModSdkHost,
  getRuntimeHookRuntime,
  resetRuntimeHostForTesting,
  setInternalModSdkHost,
} from '../src/runtime/mod';
import {
  MINTYOU_MOD_ID,
  MINTYOU_RUNTIME_PROFILE_READ_AGENT,
} from '../../../nimi-mods/runtime/mint-you/src/contracts.js';
import { registerMintYouDataCapabilities } from '../../../nimi-mods/runtime/mint-you/src/registrars/data.js';
import {
  requestPhoto,
  respondToRequest,
} from '../../../nimi-mods/runtime/mint-you/src/services/photo-auth.js';

function installRuntimeStorageTauriMock(): () => void {
  const storage = new Map<string, string>();
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command === 'runtime_mod_storage_sqlite_query') {
          const params = (payload as { payload?: { params?: unknown[] } })?.payload?.params || [];
          const namespace = String(params[0] || '');
          const key = String(params[1] || '');
          const stored = storage.get(`${namespace}:${key}`);
          return stored == null ? { rows: [] } : { rows: [{ value: stored }] };
        }

        if (command === 'runtime_mod_storage_sqlite_execute') {
          const sql = String((payload as { payload?: { sql?: string } })?.payload?.sql || '').toLowerCase();
          const params = (payload as { payload?: { params?: unknown[] } })?.payload?.params || [];
          const namespace = String(params[0] || '');
          const key = String(params[1] || '');
          if (sql.includes('create table if not exists mod_state_kv')) {
            return { rowsAffected: 0, lastInsertRowid: 0 };
          }
          if (sql.includes('insert into mod_state_kv')) {
            storage.set(`${namespace}:${key}`, String(params[2] || ''));
            return { rowsAffected: 1, lastInsertRowid: 0 };
          }
          if (sql.includes('delete from mod_state_kv')) {
            storage.delete(`${namespace}:${key}`);
            return { rowsAffected: 1, lastInsertRowid: 0 };
          }
        }

        throw new Error(`UNEXPECTED_TAURI_COMMAND:${command}`);
      },
    },
  };

  return () => {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__TAURI__;
    } else {
      globalRecord.__TAURI__ = previousTauri;
    }
  };
}

function createRuntimeContext(hookRuntime: ReturnType<typeof getRuntimeHookRuntime>) {
  const runtimeHost = {
    getRuntimeHookRuntime: () => hookRuntime,
    checkLocalLlmHealth: async () => ({
      healthy: true,
      status: 'healthy',
    }),
    getModLocalProfileSnapshot: async () => ({
      modId: MINTYOU_MOD_ID,
      status: 'ready',
      routeSource: 'unknown',
      warnings: [],
      entries: [],
      repairActions: [],
      updatedAt: new Date().toISOString(),
    }),
    route: {
      listOptions: async () => ({
        selected: null,
        resolvedDefault: null,
        local: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        source: 'cloud',
        connectorId: 'connector-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        endpoint: 'https://api.openai.com/v1',
        localOpenAiEndpoint: '',
      }),
      checkHealth: async () => ({
        healthy: true,
        status: 'healthy',
      }),
    },
    ai: {
      text: {
        generate: async () => {
          throw new Error('UNEXPECTED_TEXT_GENERATE');
        },
        stream: async () => {
          throw new Error('UNEXPECTED_TEXT_STREAM');
        },
      },
      embedding: {
        generate: async () => {
          throw new Error('UNEXPECTED_EMBEDDING_GENERATE');
        },
      },
    },
    media: {
      image: {
        generate: async () => {
          throw new Error('UNEXPECTED_IMAGE_GENERATE');
        },
        stream: async () => {
          throw new Error('UNEXPECTED_IMAGE_STREAM');
        },
      },
      video: {
        generate: async () => {
          throw new Error('UNEXPECTED_VIDEO_GENERATE');
        },
        stream: async () => {
          throw new Error('UNEXPECTED_VIDEO_STREAM');
        },
      },
      tts: {
        synthesize: async () => {
          throw new Error('UNEXPECTED_TTS_SYNTHESIZE');
        },
        stream: async () => {
          throw new Error('UNEXPECTED_TTS_STREAM');
        },
        listVoices: async () => ({
          voices: [],
        }),
      },
      stt: {
        transcribe: async () => {
          throw new Error('UNEXPECTED_STT_TRANSCRIBE');
        },
      },
      jobs: {
        get: async () => {
          throw new Error('UNEXPECTED_JOB_GET');
        },
        cancel: async () => {
          throw new Error('UNEXPECTED_JOB_CANCEL');
        },
        subscribe: async () => {
          throw new Error('UNEXPECTED_JOB_SUBSCRIBE');
        },
        getArtifacts: async () => {
          throw new Error('UNEXPECTED_JOB_ARTIFACTS');
        },
      },
    },
    voice: {
      getAsset: async () => {
        throw new Error('UNEXPECTED_VOICE_GET');
      },
      listAssets: async () => {
        throw new Error('UNEXPECTED_VOICE_LIST');
      },
      deleteAsset: async () => {
        throw new Error('UNEXPECTED_VOICE_DELETE');
      },
      listPresetVoices: async () => ({
        voices: [],
      }),
    },
  };

  return {
    runtime: hookRuntime as never,
    runtimeHost: runtimeHost as never,
  };
}

function installModSdkHost(runtimeHost: Record<string, unknown>): () => void {
  setInternalModSdkHost({
    runtime: runtimeHost as never,
    ui: {
      useAppStore: () => undefined as never,
      SlotHost: (() => null) as never,
      useUiExtensionContext: () => ({
        isAuthenticated: false,
        activeTab: 'mods',
        setActiveTab: () => {},
        runtimeFields: {},
        setRuntimeFields: () => {},
      }),
    },
    logging: {
      emitRuntimeLog: () => {},
      createRendererFlowId: (prefix: string) => `${prefix}-test-flow`,
      logRendererEvent: () => {},
    },
  });
  return () => {
    clearInternalModSdkHost();
  };
}

test('loadAgentDetails reapplies mint-you profile filter per viewer on cached profiles', async () => {
  resetRuntimeHostForTesting();
  const restoreTauri = installRuntimeStorageTauriMock();

  try {
    const hookRuntime = getRuntimeHookRuntime();
    hookRuntime.setModSourceType(MINTYOU_MOD_ID, 'builtin');
    hookRuntime.setCapabilityBaseline(MINTYOU_MOD_ID, [MINTYOU_RUNTIME_PROFILE_READ_AGENT]);

    const runtimeContext = createRuntimeContext(hookRuntime);
    const restoreHost = installModSdkHost(runtimeContext.runtimeHost as Record<string, unknown>);
    const hookClient = createHookClient(
      MINTYOU_MOD_ID,
      runtimeContext,
    );
    try {
      await registerMintYouDataCapabilities({ hookClient });

      const agentId = 'agent-owner-cached';
      const profile = {
        id: agentId,
        isAgent: true,
        worldId: 'world-cache',
        handle: 'cached-agent',
        referenceImageUrl: 'https://example.com/cached-photo.png',
      };

      let fetchCount = 0;
      const callApi = async (
        task: (
          realm: {
            services: {
              AgentsService: {
                getAgent: (agentId: string) => Promise<unknown>;
                getAgentByHandle: (handle: string) => Promise<unknown>;
              };
              WorldsService: {
                worldControllerGetWorld: (worldId: string) => Promise<unknown>;
              };
            };
          },
        ) => Promise<unknown>,
      ) => {
        fetchCount += 1;
        return task({
          services: {
            AgentsService: {
              getAgent: async () => profile,
              getAgentByHandle: async () => profile,
            },
            WorldsService: {
              worldControllerGetWorld: async () => ({
                id: 'world-cache',
                name: 'Cached World',
                bannerUrl: 'https://example.com/world-banner.png',
              }),
            },
          },
        });
      };
      const emittedErrors: string[] = [];
      const emitDataSyncError = (action: string) => {
        emittedErrors.push(action);
      };

      const unauthorized = await loadAgentDetails(callApi as never, emitDataSyncError, agentId, {
        viewerUserId: 'viewer-a',
        worldId: 'world-cache',
      });
      assert.equal(unauthorized.referenceImageUrl, null);
      const fetchCountAfterInitialLoad = fetchCount;
      assert.equal(fetchCountAfterInitialLoad > 0, true);

      await requestPhoto(hookClient.storage, 'viewer-b', agentId, 'world-cache');
      await respondToRequest(hookClient.storage, agentId, 'viewer-b', 'world-cache', true);

      const authorized = await loadAgentDetails(callApi as never, emitDataSyncError, agentId, {
        viewerUserId: 'viewer-b',
        worldId: 'world-cache',
      });
      assert.equal(authorized.referenceImageUrl, 'https://example.com/cached-photo.png');

      const unauthorizedAgain = await loadAgentDetails(callApi as never, emitDataSyncError, agentId, {
        viewerUserId: 'viewer-a',
        worldId: 'world-cache',
      });
      assert.equal(unauthorizedAgain.referenceImageUrl, null);

      assert.equal(fetchCount, fetchCountAfterInitialLoad);
      assert.deepEqual(emittedErrors, []);
    } finally {
      restoreHost();
    }
  } finally {
    resetRuntimeHostForTesting();
    restoreTauri();
  }
});
