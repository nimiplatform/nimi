const TOKEN_STORAGE_UNAVAILABLE_MESSAGE =
  'Relay secure token storage is unavailable in packaged builds.';
const TOKEN_STORAGE_CORRUPTED_MESSAGE =
  'Relay persisted auth token is unreadable and has been cleared.';

export type TokenStoreDeps = {
  getTokenPath: () => string;
  isPackaged: () => boolean;
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string) => Buffer;
  writeFileSync: (
    filePath: string,
    data: string | Uint8Array,
    options?: BufferEncoding | { encoding?: BufferEncoding; mode?: number },
  ) => void;
  unlinkSync: (filePath: string) => void;
};

const TOKEN_FILE_MODE = 0o600;

function allowPlaintextTokenFallback(isPackagedBuild: boolean): boolean {
  return !isPackagedBuild;
}

export function createTokenStore(deps: TokenStoreDeps) {
  function clearToken(): void {
    const tokenPath = deps.getTokenPath();
    try {
      if (deps.existsSync(tokenPath)) {
        deps.unlinkSync(tokenPath);
      }
    } catch (err) {
      console.warn('[relay:auth] clearToken failed', err);
    }
  }

  function saveToken(accessToken: string): void {
    if (!deps.isEncryptionAvailable()) {
      if (!allowPlaintextTokenFallback(deps.isPackaged())) {
        throw new Error(TOKEN_STORAGE_UNAVAILABLE_MESSAGE);
      }
      deps.writeFileSync(deps.getTokenPath(), accessToken, { encoding: 'utf-8', mode: TOKEN_FILE_MODE });
      return;
    }
    const encrypted = deps.encryptString(accessToken);
    deps.writeFileSync(deps.getTokenPath(), encrypted, { mode: TOKEN_FILE_MODE });
  }

  function loadToken(): string | null {
    const tokenPath = deps.getTokenPath();
    if (!deps.existsSync(tokenPath)) {
      return null;
    }

    try {
      const raw = deps.readFileSync(tokenPath);
      if (!deps.isEncryptionAvailable()) {
        if (!allowPlaintextTokenFallback(deps.isPackaged())) {
          clearToken();
          throw new Error(TOKEN_STORAGE_UNAVAILABLE_MESSAGE);
        }
        return raw.toString('utf-8').trim() || null;
      }
      const decrypted = deps.decryptString(raw);
      return decrypted.trim() || null;
    } catch (err) {
      const isPackagedBuild = !allowPlaintextTokenFallback(deps.isPackaged());
      console.warn('[relay:auth] token corrupted or unreadable, clearing', err);
      clearToken();
      if (isPackagedBuild) {
        if (err instanceof Error && err.message === TOKEN_STORAGE_UNAVAILABLE_MESSAGE) {
          throw err;
        }
        throw new Error(TOKEN_STORAGE_CORRUPTED_MESSAGE);
      }
      return null;
    }
  }

  return {
    saveToken,
    loadToken,
    clearToken,
  };
}
