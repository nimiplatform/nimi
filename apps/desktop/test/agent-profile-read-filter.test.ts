import assert from 'node:assert/strict';
import test from 'node:test';

import { clearModSdkHost, setModSdkHost } from '@nimiplatform/sdk/mod/host';
import { createHookClient } from '@nimiplatform/sdk/mod/hook';
import { loadAgentDetails } from '../src/runtime/data-sync/flows/agent-runtime-flow';
import {
  getRuntimeHookRuntime,
  resetRuntimeHostForTesting,
} from '../src/runtime/mod/host';
import {
  MINTYOU_MOD_ID,
  MINTYOU_RUNTIME_PROFILE_READ_AGENT,
} from '../../../nimi-mods/mint-you/src/contracts.js';
import { registerMintYouDataCapabilities } from '../../../nimi-mods/mint-you/src/registrars/data.js';
import {
  requestPhoto,
  respondToRequest,
} from '../../../nimi-mods/mint-you/src/services/photo-auth.js';

type LocalStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function installLocalStorage(): () => void {
  const store = new Map<string, string>();
  const previous = (globalThis as typeof globalThis & {
    localStorage?: LocalStorageLike;
  }).localStorage;
  const localStorage: LocalStorageLike = {
    getItem: (key) => (store.has(key) ? store.get(key) || null : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  };
  (globalThis as typeof globalThis & { localStorage?: LocalStorageLike }).localStorage = localStorage;
  return () => {
    if (previous) {
      (globalThis as typeof globalThis & { localStorage?: LocalStorageLike }).localStorage = previous;
    } else {
      delete (globalThis as typeof globalThis & { localStorage?: LocalStorageLike }).localStorage;
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
    getModAiDependencySnapshot: async () => ({
      modId: MINTYOU_MOD_ID,
      status: 'ready',
      routeSource: 'unknown',
      warnings: [],
      dependencies: [],
      repairActions: [],
      updatedAt: new Date().toISOString(),
    }),
    route: {
      listOptions: async () => ({
        selected: null,
        resolvedDefault: null,
        localRuntime: { models: [] },
        connectors: [],
      }),
      resolve: async () => ({
        source: 'token-api',
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
  setModSdkHost({
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
    clearModSdkHost();
  };
}

test('loadAgentDetails reapplies mint-you profile filter per viewer on cached profiles', async () => {
  const restoreLocalStorage = installLocalStorage();
  resetRuntimeHostForTesting();

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
        handle: '~cached-agent',
        referenceImageUrl: 'https://example.com/cached-photo.png',
      };

      let fetchCount = 0;
      const callApi = async (task: (realm: { raw: { request: () => Promise<unknown> } }) => Promise<unknown>) => {
        fetchCount += 1;
        return task({
          raw: {
            request: async () => profile,
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

      requestPhoto('viewer-b', agentId, 'world-cache');
      respondToRequest(agentId, 'viewer-b', 'world-cache', true);

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

      assert.equal(fetchCount, 1);
      assert.deepEqual(emittedErrors, []);
    } finally {
      restoreHost();
    }
  } finally {
    resetRuntimeHostForTesting();
    restoreLocalStorage();
  }
});
