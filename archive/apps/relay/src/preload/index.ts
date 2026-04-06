// RL-IPC-004 — Preload Security Boundary
// RL-IPC-005 — IPC Serialization Constraints
// Never expose raw ipcRenderer object

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  NimiRelayBridge,
  RelayEventChannel,
  RelayEventPayload,
  RelayInvokeArgs,
  RelayInvokeChannel,
  RelayInvokeResponse,
} from '../shared/ipc-contract.js';

type ListenerEntry = {
  channel: RelayEventChannel;
  handler: (_event: IpcRendererEvent, payload: unknown) => void;
};

const listenerRegistry = new Map<string, ListenerEntry>();
let nextListenerId = 0;

function invoke<K extends RelayInvokeChannel>(
  channel: K,
  ...args: RelayInvokeArgs<K>
): Promise<RelayInvokeResponse<K>> {
  const input = args[0];
  return ipcRenderer.invoke(channel, input) as Promise<RelayInvokeResponse<K>>;
}

function addListener<K extends RelayEventChannel>(
  channel: K,
  callback: (payload: RelayEventPayload<K>) => void,
): string {
  const id = `l_${++nextListenerId}`;
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    callback(payload as RelayEventPayload<K>);
  };
  ipcRenderer.on(channel, handler);
  listenerRegistry.set(id, { channel, handler });
  return id;
}

function removeListener(id: string): void {
  const entry = listenerRegistry.get(id);
  if (!entry) {
    return;
  }
  ipcRenderer.removeListener(entry.channel, entry.handler);
  listenerRegistry.delete(id);
}

const api: NimiRelayBridge = {
  config: () => invoke('relay:config'),
  health: () => invoke('relay:health'),
  ai: {
    generate: (input) => invoke('relay:ai:generate', input),
    streamOpen: (input) => invoke('relay:ai:stream:open', input),
    streamCancel: (streamId) => invoke('relay:ai:stream:cancel', { streamId }),
  },
  media: {
    tts: {
      synthesize: (input) => invoke('relay:media:tts:synthesize', input),
      listVoices: (input) => invoke('relay:media:tts:voices', input),
    },
    stt: {
      transcribe: (input) => invoke('relay:media:stt:transcribe', input),
    },
    image: {
      generate: (input) => invoke('relay:media:image:generate', input),
    },
    video: {
      generate: (input) => invoke('relay:media:video:generate', input),
      job: {
        subscribe: (jobId) => invoke('relay:media:video:job:subscribe', { jobId }),
        get: (jobId) => invoke('relay:media:video:job:get', { jobId }),
        artifacts: (jobId) => invoke('relay:media:video:job:artifacts', { jobId }),
        cancel: (streamId) => invoke('relay:media:video:job:cancel', { streamId }),
      },
    },
  },
  agent: {
    list: () => invoke('relay:agent:list'),
    get: (agentId) => invoke('relay:agent:get', { agentId }),
  },
  realtime: {
    subscribe: (channel) => invoke('relay:realtime:subscribe', channel),
    unsubscribe: (channel) => invoke('relay:realtime:unsubscribe', channel),
    onMessage: (callback) => addListener('relay:realtime:message', callback),
    onPresence: (callback) => addListener('relay:realtime:presence', callback),
    onStatus: (callback) => addListener('relay:realtime:status', callback),
    removeListener,
  },
  stream: {
    onChunk: (callback) => addListener('relay:stream:chunk', callback),
    onEnd: (callback) => addListener('relay:stream:end', callback),
    onError: (callback) => addListener('relay:stream:error', callback),
    removeListener,
  },
  auth: {
    getStatus: () => invoke('relay:auth:status'),
    applyToken: (payload) => invoke('relay:auth:apply-token', payload),
    checkEmail: (payload) => invoke('relay:auth:check-email', payload),
    passwordLogin: (payload) => invoke('relay:auth:password-login', payload),
    oauthLogin: (payload) => invoke('relay:auth:oauth-login', payload),
    requestEmailOtp: (payload) => invoke('relay:auth:email-otp-request', payload),
    verifyEmailOtp: (payload) => invoke('relay:auth:email-otp-verify', payload),
    verifyTwoFactor: (payload) => invoke('relay:auth:2fa-verify', payload),
    walletChallenge: (payload) => invoke('relay:auth:wallet-challenge', payload),
    walletLogin: (payload) => invoke('relay:auth:wallet-login', payload),
    updatePassword: (payload) => invoke('relay:auth:update-password', payload),
    currentUser: (payload) => invoke('relay:auth:current-user', payload),
    logout: () => invoke('relay:auth:logout'),
    onStatus: (callback) => addListener('relay:auth:status', callback),
    removeListener,
  },
  oauth: {
    listenForCode: (payload) => invoke('relay:oauth:listen-for-code', payload),
    openExternalUrl: (url) => invoke('relay:oauth:open-external-url', { url }),
    focusMainWindow: () => invoke('relay:oauth:focus-main-window'),
    tokenExchange: (payload) => invoke('relay:oauth:token-exchange', payload),
  },
  model: {
    list: (input) => invoke('relay:model:list', input),
    pull: (input) => invoke('relay:model:pull', input),
    remove: (input) => invoke('relay:model:remove', input),
    checkHealth: (input) => invoke('relay:model:health', input),
  },
  local: {
    listAssets: (input) => invoke('relay:local:assets:list', input),
    listVerifiedAssets: (input) => invoke('relay:local:assets:verified', input),
    searchAssetCatalog: (input) => invoke('relay:local:assets:catalog-search', input),
    resolveAssetInstallPlan: (input) => invoke('relay:local:assets:install-plan', input),
    installAsset: (input) => invoke('relay:local:assets:install', input),
    installVerifiedAsset: (input) => invoke('relay:local:assets:install-verified', input),
    importAsset: (input) => invoke('relay:local:assets:import', input),
    removeAsset: (input) => invoke('relay:local:assets:remove', input),
    startAsset: (input) => invoke('relay:local:assets:start', input),
    stopAsset: (input) => invoke('relay:local:assets:stop', input),
    checkAssetHealth: (input) => invoke('relay:local:assets:health', input),
    warmAsset: (input) => invoke('relay:local:assets:warm', input),
    collectDeviceProfile: (input) => invoke('relay:local:device-profile', input),
    resolveProfile: (input) => invoke('relay:local:profile:resolve', input),
    listNodeCatalog: (input) => invoke('relay:local:catalog:nodes', input),
  },
  connector: {
    create: (input) => invoke('relay:connector:create', input),
    get: (input) => invoke('relay:connector:get', input),
    list: (input) => invoke('relay:connector:list', input),
    update: (input) => invoke('relay:connector:update', input),
    delete: (input) => invoke('relay:connector:delete', input),
    test: (input) => invoke('relay:connector:test', input),
    listModels: (input) => invoke('relay:connector:models', input),
    listProviderCatalog: (input) => invoke('relay:connector:provider-catalog', input),
    listCatalogProviders: (input) => invoke('relay:connector:catalog-providers', input),
    listCatalogProviderModels: (input) => invoke('relay:connector:catalog-provider-models', input),
    getCatalogModelDetail: (input) => invoke('relay:connector:catalog-model-detail', input),
    upsertCatalogProvider: (input) => invoke('relay:connector:catalog-provider:upsert', input),
    deleteCatalogProvider: (input) => invoke('relay:connector:catalog-provider:delete', input),
    upsertCatalogOverlay: (input) => invoke('relay:connector:catalog-overlay:upsert', input),
    deleteCatalogOverlay: (input) => invoke('relay:connector:catalog-overlay:delete', input),
  },
  route: {
    getOptions: () => invoke('relay:route:options'),
    getBinding: () => invoke('relay:route:binding:get'),
    setBinding: (input) => invoke('relay:route:binding:set', input),
    getSnapshot: () => invoke('relay:route:snapshot'),
    refresh: () => invoke('relay:route:refresh'),
  },
  mediaRoute: {
    getOptions: (input) => invoke('relay:media-route:options', input),
  },
  desktop: {
    openConfig: (pageId) => invoke('relay:desktop:open-config', pageId ? { pageId } : undefined),
  },
  directChat: {
    send: (input) => invoke('relay:direct-chat:send', input),
    cancel: (input) => invoke('relay:direct-chat:cancel', input),
    history: () => invoke('relay:direct-chat:history'),
    clear: (input) => invoke('relay:direct-chat:clear', input),
  },
  chat: {
    send: (input) => invoke('relay:chat:send', input),
    cancel: (input) => invoke('relay:chat:cancel', input),
    history: (input) => invoke('relay:chat:history', input),
    clear: (input) => invoke('relay:chat:clear', input),
    settings: {
      get: () => invoke('relay:chat:settings:get'),
      set: (patch) => invoke('relay:chat:settings:set', patch),
    },
    proactive: {
      toggle: (enabled) => invoke('relay:chat:proactive:toggle', { enabled }),
    },
    onTurnPhase: (callback) => addListener('relay:chat:turn:phase', callback),
    onBeat: (callback) => addListener('relay:chat:beat', callback),
    onTurnDone: (callback) => addListener('relay:chat:turn:done', callback),
    onTurnError: (callback) => addListener('relay:chat:turn:error', callback),
    onMessages: (callback) => addListener('relay:chat:messages', callback),
    onSessions: (callback) => addListener('relay:chat:sessions', callback),
    onStatusBanner: (callback) => addListener('relay:chat:status-banner', callback),
    onPromptTrace: (callback) => addListener('relay:chat:prompt-trace', callback),
    onTurnAudit: (callback) => addListener('relay:chat:turn-audit', callback),
    removeListener,
  },
};

contextBridge.exposeInMainWorld('nimiRelay', api);
