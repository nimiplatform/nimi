// RL-IPC-004 — Preload Security Boundary
// RL-IPC-005 — IPC Serialization Constraints
// Never expose raw ipcRenderer object

import { contextBridge, ipcRenderer } from 'electron';

// Listener registry — contextBridge cannot serialize returned functions,
// so on* methods return a string ID and removeListener(id) cleans up.
const listenerRegistry = new Map<string, { channel: string; handler: (...args: unknown[]) => void }>();
let nextListenerId = 0;

function addListener(channel: string, callback: (...args: unknown[]) => void): string {
  const id = `l_${++nextListenerId}`;
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, handler as never);
  listenerRegistry.set(id, { channel, handler: handler as never });
  return id;
}

function removeListener(id: string): void {
  const entry = listenerRegistry.get(id);
  if (entry) {
    ipcRenderer.removeListener(entry.channel, entry.handler as never);
    listenerRegistry.delete(id);
  }
}

const api = {
  // Config (RL-CORE-003: expose env defaults to renderer)
  config: () => ipcRenderer.invoke('relay:config') as Promise<{ agentId: string | null; worldId: string | null }>,

  // Health
  health: () => ipcRenderer.invoke('relay:health'),

  // AI (RL-IPC-006)
  ai: {
    generate: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:ai:generate', input),
    streamOpen: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:ai:stream:open', input),
    streamCancel: (streamId: string) => ipcRenderer.invoke('relay:ai:stream:cancel', { streamId }),
  },

  // Media (RL-IPC-007)
  media: {
    tts: {
      synthesize: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:media:tts:synthesize', input),
      listVoices: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:media:tts:voices', input),
    },
    stt: {
      transcribe: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:media:stt:transcribe', input),
    },
    image: {
      generate: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:media:image:generate', input),
    },
    video: {
      generate: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:media:video:generate', input),
      job: {
        subscribe: (jobId: string) => ipcRenderer.invoke('relay:media:video:job:subscribe', { jobId }),
        get: (jobId: string) => ipcRenderer.invoke('relay:media:video:job:get', { jobId }),
        artifacts: (jobId: string) => ipcRenderer.invoke('relay:media:video:job:artifacts', { jobId }),
        cancel: (streamId: string) => ipcRenderer.invoke('relay:media:video:job:cancel', { streamId }),
      },
    },
  },

  // Realm (RL-IPC-008)
  realm: {
    request: (input: { agentId?: string; method: string; path: string; body?: unknown; headers?: Record<string, string> }) =>
      ipcRenderer.invoke('relay:realm:request', input),
  },

  // Realtime (RL-IPC-009)
  realtime: {
    subscribe: (channel: string) => ipcRenderer.invoke('relay:realtime:subscribe', channel),
    unsubscribe: (channel: string) => ipcRenderer.invoke('relay:realtime:unsubscribe', channel),
    onMessage: (cb: (...args: unknown[]) => void) => addListener('relay:realtime:message', cb),
    onPresence: (cb: (...args: unknown[]) => void) => addListener('relay:realtime:presence', cb),
    onStatus: (cb: (...args: unknown[]) => void) => addListener('relay:realtime:status', cb),
    removeListener,
  },

  // Stream events (RL-IPC-003)
  stream: {
    onChunk: (cb: (...args: unknown[]) => void) => addListener('relay:stream:chunk', cb),
    onEnd: (cb: (...args: unknown[]) => void) => addListener('relay:stream:end', cb),
    onError: (cb: (...args: unknown[]) => void) => addListener('relay:stream:error', cb),
    removeListener,
  },

  // Auth (RL-BOOT-005)
  auth: {
    getStatus: () => ipcRenderer.invoke('relay:auth:status') as Promise<{ state: string; error: string | null }>,
    applyToken: (payload: { accessToken: string }) =>
      ipcRenderer.invoke('relay:auth:apply-token', payload) as Promise<{ success: boolean; error?: string }>,
    realmRequest: (payload: { method: string; path: string; body?: unknown; accessToken?: string }) =>
      ipcRenderer.invoke('relay:auth:realm-request', payload),
    checkEmail: (payload: { email: string }) =>
      ipcRenderer.invoke('relay:auth:check-email', payload),
    passwordLogin: (payload: { identifier: string; password: string }) =>
      ipcRenderer.invoke('relay:auth:password-login', payload),
    oauthLogin: (payload: { provider: string; accessToken: string }) =>
      ipcRenderer.invoke('relay:auth:oauth-login', payload),
    requestEmailOtp: (payload: { email: string }) =>
      ipcRenderer.invoke('relay:auth:email-otp-request', payload),
    verifyEmailOtp: (payload: { email: string; code: string }) =>
      ipcRenderer.invoke('relay:auth:email-otp-verify', payload),
    verifyTwoFactor: (payload: { tempToken: string; code: string }) =>
      ipcRenderer.invoke('relay:auth:2fa-verify', payload),
    walletChallenge: (payload: { walletAddress: string; chainId?: number; walletType: string }) =>
      ipcRenderer.invoke('relay:auth:wallet-challenge', payload),
    walletLogin: (payload: { walletAddress: string; chainId?: number; nonce: string; message: string; signature: string; walletType: string }) =>
      ipcRenderer.invoke('relay:auth:wallet-login', payload),
    updatePassword: (payload: { newPassword: string; accessToken?: string }) =>
      ipcRenderer.invoke('relay:auth:update-password', payload),
    currentUser: (payload?: { accessToken?: string }) =>
      ipcRenderer.invoke('relay:auth:current-user', payload),
    logout: () => ipcRenderer.invoke('relay:auth:logout') as Promise<void>,
    onStatus: (cb: (...args: unknown[]) => void) => addListener('relay:auth:status', cb),
    removeListener,
  },

  // OAuth primitives (RL-BOOT-005)
  oauth: {
    listenForCode: (payload: { redirectUri: string; timeoutMs?: number }) =>
      ipcRenderer.invoke('relay:oauth:listen-for-code', payload) as Promise<{ callbackUrl: string; code?: string; state?: string; error?: string }>,
    openExternalUrl: (url: string) =>
      ipcRenderer.invoke('relay:oauth:open-external-url', { url }) as Promise<{ opened: boolean }>,
    focusMainWindow: () =>
      ipcRenderer.invoke('relay:oauth:focus-main-window') as Promise<void>,
    tokenExchange: (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('relay:oauth:token-exchange', payload),
  },

  // Model service (RL-IPC-010)
  model: {
    list: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:model:list', input),
    pull: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:model:pull', input),
    remove: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:model:remove', input),
    checkHealth: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:model:health', input),
  },

  // Local runtime (RL-IPC-011)
  local: {
    listModels: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:list', input),
    listVerifiedModels: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:verified', input),
    searchCatalog: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:catalog-search', input),
    resolveInstallPlan: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:install-plan', input),
    installModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:install', input),
    installVerifiedModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:install-verified', input),
    importModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:import', input),
    removeModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:remove', input),
    startModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:start', input),
    stopModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:stop', input),
    checkModelHealth: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:health', input),
    warmModel: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:models:warm', input),
    collectDeviceProfile: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:local:device-profile', input),
    resolveProfile: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:local:profile:resolve', input),
    listNodeCatalog: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:local:catalog:nodes', input),
  },

  // Connector (RL-IPC-012)
  connector: {
    create: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:create', input),
    get: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:get', input),
    list: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:list', input),
    update: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:update', input),
    delete: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:delete', input),
    test: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:test', input),
    listModels: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:models', input),
    listProviderCatalog: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:provider-catalog', input),
    listCatalogProviders: (input?: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-providers', input),
    listCatalogProviderModels: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-provider-models', input),
    getCatalogModelDetail: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-model-detail', input),
    upsertCatalogProvider: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-provider:upsert', input),
    deleteCatalogProvider: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-provider:delete', input),
    upsertCatalogOverlay: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-overlay:upsert', input),
    deleteCatalogOverlay: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:connector:catalog-overlay:delete', input),
  },

  // Route selection (relay:route:*)
  route: {
    getOptions: () => ipcRenderer.invoke('relay:route:options'),
    getBinding: () => ipcRenderer.invoke('relay:route:binding:get'),
    setBinding: (input: Record<string, unknown>) => ipcRenderer.invoke('relay:route:binding:set', input),
    getSnapshot: () => ipcRenderer.invoke('relay:route:snapshot'),
    refresh: () => ipcRenderer.invoke('relay:route:refresh'),
  },

  // Desktop interop (RL-IPC-013)
  desktop: {
    openConfig: (pageId?: string) => ipcRenderer.invoke('relay:desktop:open-config', { pageId }),
  },

  // Chat pipeline (RL-PIPE-*)
  chat: {
    send: (input: { agentId: string; text: string; sessionId?: string }) =>
      ipcRenderer.invoke('relay:chat:send', input),
    cancel: (input: { turnTxnId: string }) =>
      ipcRenderer.invoke('relay:chat:cancel', input),
    history: (input: { agentId: string }) =>
      ipcRenderer.invoke('relay:chat:history', input),
    clear: (input: { agentId: string; sessionId: string }) =>
      ipcRenderer.invoke('relay:chat:clear', input),
    settings: {
      get: () => ipcRenderer.invoke('relay:chat:settings:get'),
      set: (patch: Record<string, unknown>) =>
        ipcRenderer.invoke('relay:chat:settings:set', patch),
    },
    proactive: {
      toggle: (enabled: boolean) =>
        ipcRenderer.invoke('relay:chat:proactive:toggle', { enabled }),
    },
    // Push events from main → renderer
    onTurnPhase: (cb: (...args: unknown[]) => void) => addListener('relay:chat:turn:phase', cb),
    onBeat: (cb: (...args: unknown[]) => void) => addListener('relay:chat:beat', cb),
    onTurnDone: (cb: (...args: unknown[]) => void) => addListener('relay:chat:turn:done', cb),
    onTurnError: (cb: (...args: unknown[]) => void) => addListener('relay:chat:turn:error', cb),
    onMessages: (cb: (...args: unknown[]) => void) => addListener('relay:chat:messages', cb),
    onSessions: (cb: (...args: unknown[]) => void) => addListener('relay:chat:sessions', cb),
    onStatusBanner: (cb: (...args: unknown[]) => void) => addListener('relay:chat:status-banner', cb),
    onPromptTrace: (cb: (...args: unknown[]) => void) => addListener('relay:chat:prompt-trace', cb),
    onTurnAudit: (cb: (...args: unknown[]) => void) => addListener('relay:chat:turn-audit', cb),
    removeListener,
  },
};

contextBridge.exposeInMainWorld('nimiRelay', api);
