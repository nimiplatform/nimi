// RL-BOOT-005 — Encrypted Token Persistence
// Uses Electron safeStorage to encrypt/decrypt access token at rest

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILE = 'relay-auth.dat';

function getTokenPath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILE);
}

export function saveToken(accessToken: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: write plaintext (dev-only scenario)
    fs.writeFileSync(getTokenPath(), accessToken, 'utf-8');
    return;
  }
  const encrypted = safeStorage.encryptString(accessToken);
  fs.writeFileSync(getTokenPath(), encrypted);
}

export function loadToken(): string | null {
  const tokenPath = getTokenPath();
  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(tokenPath);
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: read as plaintext
      return raw.toString('utf-8').trim() || null;
    }
    const decrypted = safeStorage.decryptString(raw);
    return decrypted.trim() || null;
  } catch {
    // Corrupted or unreadable — clear and return null
    clearToken();
    return null;
  }
}

export function clearToken(): void {
  const tokenPath = getTokenPath();
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
  } catch {
    // Best-effort cleanup
  }
}
