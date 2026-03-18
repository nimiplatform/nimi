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
    browserLogin: () => Promise<{ success: boolean; error?: string }>;
    onStatus: (callback: (payload: { state: string; error: string | null }) => void) => string;
    removeListener: (id: string) => void;
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
