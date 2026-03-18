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
    retry: () => ipcRenderer.invoke('relay:auth:retry') as Promise<{ success: boolean; error?: string }>,
    onStatus: (cb: (...args: unknown[]) => void) => addListener('relay:auth:status', cb),
    removeListener,
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
