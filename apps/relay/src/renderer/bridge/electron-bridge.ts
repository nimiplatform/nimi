// Typed wrapper for window.nimiRelay bridge API
// RL-IPC-004, RL-IPC-005

export interface NimiRelayBridge {
  config: () => Promise<{ agentId: string | null; worldId: string | null }>;
  health: () => Promise<unknown>;
  ai: {
    generate: (input: Record<string, unknown>) => Promise<unknown>;
    streamOpen: (input: Record<string, unknown>) => Promise<{ streamId: string }>;
    streamCancel: (streamId: string) => Promise<void>;
  };
  media: {
    tts: {
      synthesize: (input: Record<string, unknown>) => Promise<unknown>;
      listVoices: (input: Record<string, unknown>) => Promise<unknown>;
    };
    stt: {
      transcribe: (input: Record<string, unknown>) => Promise<unknown>;
    };
    image: {
      generate: (input: Record<string, unknown>) => Promise<unknown>;
    };
    video: {
      generate: (input: Record<string, unknown>) => Promise<unknown>;
      job: {
        subscribe: (jobId: string) => Promise<{ streamId: string }>;
        get: (jobId: string) => Promise<unknown>;
        artifacts: (jobId: string) => Promise<unknown>;
        cancel: (streamId: string) => Promise<void>;
      };
    };
  };
  realm: {
    request: (input: {
      agentId?: string;
      method: string;
      path: string;
      body?: unknown;
      headers?: Record<string, string>;
    }) => Promise<unknown>;
  };
  realtime: {
    subscribe: (channel: string) => Promise<void>;
    unsubscribe: (channel: string) => Promise<void>;
    onMessage: (callback: (data: unknown) => void) => string;
    onPresence: (callback: (data: unknown) => void) => string;
    onStatus: (callback: (data: { connected: boolean }) => void) => string;
    removeListener: (id: string) => void;
  };
  stream: {
    onChunk: (callback: (payload: { streamId: string; data: unknown }) => void) => string;
    onEnd: (callback: (payload: { streamId: string }) => void) => string;
    onError: (callback: (payload: { streamId: string; error: unknown }) => void) => string;
    removeListener: (id: string) => void;
  };
  auth: {
    getStatus: () => Promise<{ state: string; error: string | null }>;
    applyToken: (payload: { accessToken: string }) => Promise<{ success: boolean; error?: string }>;
    realmRequest: (payload: { method: string; path: string; body?: unknown; accessToken?: string }) => Promise<unknown>;
    checkEmail: (payload: { email: string }) => Promise<unknown>;
    passwordLogin: (payload: { identifier: string; password: string }) => Promise<unknown>;
    oauthLogin: (payload: { provider: string; accessToken: string }) => Promise<unknown>;
    requestEmailOtp: (payload: { email: string }) => Promise<unknown>;
    verifyEmailOtp: (payload: { email: string; code: string }) => Promise<unknown>;
    verifyTwoFactor: (payload: { tempToken: string; code: string }) => Promise<unknown>;
    walletChallenge: (payload: { walletAddress: string; chainId?: number; walletType: string }) => Promise<unknown>;
    walletLogin: (payload: { walletAddress: string; chainId?: number; nonce: string; message: string; signature: string; walletType: string }) => Promise<unknown>;
    updatePassword: (payload: { newPassword: string; accessToken?: string }) => Promise<unknown>;
    currentUser: (payload?: { accessToken?: string }) => Promise<unknown>;
    logout: () => Promise<void>;
    onStatus: (callback: (payload: { state: string; error: string | null }) => void) => string;
    removeListener: (id: string) => void;
  };
  oauth: {
    listenForCode: (payload: { redirectUri: string; timeoutMs?: number }) => Promise<{ callbackUrl: string; code?: string; state?: string; error?: string }>;
    openExternalUrl: (url: string) => Promise<{ opened: boolean }>;
    focusMainWindow: () => Promise<void>;
    tokenExchange: (payload: Record<string, unknown>) => Promise<unknown>;
  };
  model: {
    list: (input?: Record<string, unknown>) => Promise<unknown>;
    pull: (input: Record<string, unknown>) => Promise<unknown>;
    remove: (input: Record<string, unknown>) => Promise<unknown>;
    checkHealth: (input: Record<string, unknown>) => Promise<unknown>;
  };
  local: {
    listModels: (input?: Record<string, unknown>) => Promise<unknown>;
    listVerifiedModels: (input?: Record<string, unknown>) => Promise<unknown>;
    searchCatalog: (input: Record<string, unknown>) => Promise<unknown>;
    resolveInstallPlan: (input: Record<string, unknown>) => Promise<unknown>;
    installModel: (input: Record<string, unknown>) => Promise<unknown>;
    installVerifiedModel: (input: Record<string, unknown>) => Promise<unknown>;
    importModel: (input: Record<string, unknown>) => Promise<unknown>;
    removeModel: (input: Record<string, unknown>) => Promise<unknown>;
    startModel: (input: Record<string, unknown>) => Promise<unknown>;
    stopModel: (input: Record<string, unknown>) => Promise<unknown>;
    checkModelHealth: (input: Record<string, unknown>) => Promise<unknown>;
    warmModel: (input: Record<string, unknown>) => Promise<unknown>;
    collectDeviceProfile: (input?: Record<string, unknown>) => Promise<unknown>;
    resolveProfile: (input: Record<string, unknown>) => Promise<unknown>;
    listNodeCatalog: (input?: Record<string, unknown>) => Promise<unknown>;
  };
  connector: {
    create: (input: Record<string, unknown>) => Promise<unknown>;
    get: (input: Record<string, unknown>) => Promise<unknown>;
    list: (input?: Record<string, unknown>) => Promise<unknown>;
    update: (input: Record<string, unknown>) => Promise<unknown>;
    delete: (input: Record<string, unknown>) => Promise<unknown>;
    test: (input: Record<string, unknown>) => Promise<unknown>;
    listModels: (input: Record<string, unknown>) => Promise<unknown>;
    listProviderCatalog: (input?: Record<string, unknown>) => Promise<unknown>;
    listCatalogProviders: (input?: Record<string, unknown>) => Promise<unknown>;
    listCatalogProviderModels: (input: Record<string, unknown>) => Promise<unknown>;
    getCatalogModelDetail: (input: Record<string, unknown>) => Promise<unknown>;
    upsertCatalogProvider: (input: Record<string, unknown>) => Promise<unknown>;
    deleteCatalogProvider: (input: Record<string, unknown>) => Promise<unknown>;
    upsertCatalogOverlay: (input: Record<string, unknown>) => Promise<unknown>;
    deleteCatalogOverlay: (input: Record<string, unknown>) => Promise<unknown>;
  };
  route: {
    getOptions: () => Promise<unknown>;
    getBinding: () => Promise<unknown>;
    setBinding: (input: Record<string, unknown>) => Promise<unknown>;
    getSnapshot: () => Promise<unknown>;
    refresh: () => Promise<unknown>;
  };
  desktop: {
    openConfig: (pageId?: string) => Promise<{ success: boolean }>;
  };
  chat: {
    send: (input: { agentId: string; text: string; sessionId?: string }) => Promise<void>;
    cancel: (input: { turnTxnId: string }) => Promise<void>;
    history: (input: { agentId: string }) => Promise<unknown>;
    clear: (input: { agentId: string; sessionId: string }) => Promise<void>;
    settings: {
      get: () => Promise<unknown>;
      set: (patch: Record<string, unknown>) => Promise<void>;
    };
    proactive: {
      toggle: (enabled: boolean) => Promise<void>;
    };
    onTurnPhase: (callback: (payload: { turnId?: string; phase: string }) => void) => string;
    onBeat: (callback: (payload: { turnId: string; beat: unknown }) => void) => string;
    onTurnDone: (callback: (payload: { turnId: string; diagnostics?: unknown }) => void) => string;
    onTurnError: (callback: (payload: { turnId: string; error: unknown }) => void) => string;
    onMessages: (callback: (messages: unknown[]) => void) => string;
    onSessions: (callback: (sessions: unknown[]) => void) => string;
    onStatusBanner: (callback: (banner: { kind: string; message: string }) => void) => string;
    onPromptTrace: (callback: (trace: unknown) => void) => string;
    onTurnAudit: (callback: (audit: unknown) => void) => string;
    removeListener: (id: string) => void;
  };
}

declare global {
  interface Window {
    nimiRelay: NimiRelayBridge;
  }
}

export function getBridge(): NimiRelayBridge {
  if (!window.nimiRelay) {
    throw new Error(
      'nimiRelay bridge not available. Are you running outside Electron?',
    );
  }
  return window.nimiRelay;
}
