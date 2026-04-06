// RL-BOOT-005 — Encrypted Token Persistence
// Uses Electron safeStorage to encrypt/decrypt access token at rest

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createTokenStore } from './token-store-core.js';

const TOKEN_FILE = 'relay-auth.dat';

function getTokenPath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILE);
}

export const { saveToken, loadToken, clearToken } = createTokenStore({
  getTokenPath,
  isPackaged: () => app.isPackaged,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value),
  existsSync: (filePath) => fs.existsSync(filePath),
  readFileSync: (filePath) => fs.readFileSync(filePath),
  writeFileSync: (filePath, data, encoding) => {
    if (typeof data === 'string') {
      fs.writeFileSync(filePath, data, encoding);
      return;
    }
    fs.writeFileSync(filePath, data);
  },
  unlinkSync: (filePath) => fs.unlinkSync(filePath),
});
