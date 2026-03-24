import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTokenStore } from '../src/main/auth/token-store-core.js';

let userDataDir = '';
let packaged = false;
let encryptionAvailable = true;

function tokenPath(): string {
  return path.join(userDataDir, 'relay-auth.dat');
}

const tokenStore = createTokenStore({
  getTokenPath: () => tokenPath(),
  isPackaged: () => packaged,
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value) => {
    const text = value.toString('utf8');
    if (!text.startsWith('enc:')) {
      throw new Error('decrypt failed');
    }
    return text.slice(4);
  },
  existsSync: (filePath) => fs.existsSync(filePath),
  readFileSync: (filePath) => fs.readFileSync(filePath),
  writeFileSync: (filePath, data, options) => {
    if (typeof data === 'string') {
      fs.writeFileSync(filePath, data, options as BufferEncoding | fs.WriteFileOptions | undefined);
      return;
    }
    fs.writeFileSync(filePath, data, options as fs.WriteFileOptions | undefined);
  },
  unlinkSync: (filePath) => fs.unlinkSync(filePath),
});

describe('RL-BOOT-005 — token store secure persistence', () => {
  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-relay-token-'));
    packaged = false;
    encryptionAvailable = true;
  });

  afterEach(() => {
    tokenStore.clearToken();
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      userDataDir = '';
    }
  });

  it('allows plaintext token fallback in unpackaged development mode', () => {
    encryptionAvailable = false;

    tokenStore.saveToken('dev-token');

    assert.equal(fs.readFileSync(tokenPath(), 'utf8'), 'dev-token');
    assert.equal(fs.statSync(tokenPath()).mode & 0o777, 0o600);
    assert.equal(tokenStore.loadToken(), 'dev-token');
  });

  it('writes encrypted token files with owner-only permissions', () => {
    tokenStore.saveToken('prod-token');

    assert.equal(fs.readFileSync(tokenPath(), 'utf8'), 'enc:prod-token');
    assert.equal(fs.statSync(tokenPath()).mode & 0o777, 0o600);
    assert.equal(tokenStore.loadToken(), 'prod-token');
  });

  it('fails closed on save when packaged build has no secure storage', () => {
    packaged = true;
    encryptionAvailable = false;

    assert.throws(
      () => tokenStore.saveToken('prod-token'),
      /secure token storage is unavailable in packaged builds/i,
    );
    assert.equal(fs.existsSync(tokenPath()), false);
  });

  it('clears plaintext token files and throws when packaged build cannot decrypt', () => {
    packaged = true;
    encryptionAvailable = false;
    fs.writeFileSync(tokenPath(), 'plaintext-token', 'utf8');

    assert.throws(
      () => tokenStore.loadToken(),
      /secure token storage is unavailable in packaged builds/i,
    );
    assert.equal(fs.existsSync(tokenPath()), false);
  });

  it('clears corrupted token files and throws in packaged builds', () => {
    packaged = true;
    encryptionAvailable = true;
    fs.writeFileSync(tokenPath(), 'not-encrypted', 'utf8');

    assert.throws(
      () => tokenStore.loadToken(),
      /persisted auth token is unreadable and has been cleared/i,
    );
    assert.equal(fs.existsSync(tokenPath()), false);
  });
});
