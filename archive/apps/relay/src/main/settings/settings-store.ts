// Relay settings persistence — adapted from local-chat default-settings-store.ts
// Uses Electron app.getPath('userData') for file storage, no mod SDK dependencies.

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { LocalChatSettings, LocalChatDefaultSettings } from './types.js';
import {
  DEFAULT_LOCAL_CHAT_SETTINGS,
  DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
  normalizeLocalChatSettings,
  mergeLocalChatSettings,
  normalizeLocalChatProductSettings,
  normalizeLocalChatInspectSettings,
} from './types.js';

export {
  normalizeLocalChatSettings,
  mergeLocalChatSettings,
  normalizeLocalChatProductSettings,
  normalizeLocalChatInspectSettings,
};

// ── Path helpers ────────────────────────────────────────────────────

function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), 'relay-chat', 'settings.json');
}

async function ensureSettingsDir(): Promise<void> {
  const dirPath = path.dirname(getSettingsFilePath());
  await fs.mkdir(dirPath, { recursive: true });
}

// ── In-memory cache + optionally debounced write ────────────────────

const DEBOUNCE_MS = 500;
let memoryCache: LocalChatSettings | null = null;
let pendingWrite: LocalChatSettings | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function flushWrite(): Promise<void> {
  if (!pendingWrite) return;
  const data = pendingWrite;
  pendingWrite = null;
  await ensureSettingsDir();
  await fs.writeFile(getSettingsFilePath(), JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function scheduleDebouncedWrite(settings: LocalChatSettings): void {
  pendingWrite = settings;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushWrite().catch((err) => {
      console.error('[relay:settings] background flush failed', err);
    });
  }, DEBOUNCE_MS);
}

function cancelPendingDebounce(): void {
  if (!debounceTimer) {
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = null;
}

// ── Public API ──────────────────────────────────────────────────────

export async function loadRelaySettings(): Promise<LocalChatSettings> {
  // Return in-memory cache if available (avoids stale disk reads during debounce)
  if (memoryCache) return memoryCache;
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const settings = normalizeLocalChatSettings(parsed);
    memoryCache = settings;
    return settings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[relay:settings] loadRelaySettings failed', err);
    }
    return { ...DEFAULT_LOCAL_CHAT_SETTINGS };
  }
}

export async function saveRelaySettings(
  settings: LocalChatSettings,
  options?: { flush?: boolean },
): Promise<void> {
  const normalized = normalizeLocalChatSettings(settings);
  memoryCache = normalized;
  if (options?.flush) {
    pendingWrite = normalized;
    cancelPendingDebounce();
    await flushWrite();
    return;
  }
  scheduleDebouncedWrite(normalized);
}

export function loadRelayDefaultSettings(): LocalChatDefaultSettings {
  return { ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS };
}
