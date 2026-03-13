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
