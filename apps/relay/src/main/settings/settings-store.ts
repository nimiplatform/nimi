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

// ── Debounce write ──────────────────────────────────────────────────

const DEBOUNCE_MS = 500;
let pendingWrite: LocalChatSettings | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function flushWrite(): Promise<void> {
  if (!pendingWrite) return;
  const data = pendingWrite;
  pendingWrite = null;
  try {
    await ensureSettingsDir();
    await fs.writeFile(getSettingsFilePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Swallow write errors — settings will use defaults on next load
  }
}

function scheduleDebouncedWrite(settings: LocalChatSettings): void {
  pendingWrite = settings;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushWrite();
  }, DEBOUNCE_MS);
}

// ── Public API ──────────────────────────────────────────────────────

export async function loadRelaySettings(): Promise<LocalChatSettings> {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return normalizeLocalChatSettings(parsed);
  } catch {
    return { ...DEFAULT_LOCAL_CHAT_SETTINGS };
  }
}

export function saveRelaySettings(settings: LocalChatSettings): void {
  const normalized = normalizeLocalChatSettings(settings);
  scheduleDebouncedWrite(normalized);
}

export function loadRelayDefaultSettings(): LocalChatDefaultSettings {
  return { ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS };
}
