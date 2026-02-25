import type { CredentialEntry } from './types';
import { hasTauriInvoke, tauriInvoke } from './tauri-bridge';

export interface CredentialVault {
  upsertCredentialEntry(entry: CredentialEntry): Promise<void>;
  listCredentialEntries(provider?: string): Promise<CredentialEntry[]>;
  deleteCredentialEntry(refId: string): Promise<void>;
  setCredentialSecret(refId: string, secret: string): Promise<void>;
  getCredentialSecret(refId: string): Promise<string>;
  deleteCredentialSecret(refId: string): Promise<void>;
}

export class InMemoryCredentialVault implements CredentialVault {
  private readonly entries = new Map<string, CredentialEntry>();
  private readonly secrets = new Map<string, string>();

  async upsertCredentialEntry(entry: CredentialEntry): Promise<void> {
    this.entries.set(entry.refId, entry);
  }

  async listCredentialEntries(provider?: string): Promise<CredentialEntry[]> {
    const values = Array.from(this.entries.values());
    if (!provider) {
      return values;
    }

    return values.filter((entry) => entry.provider === provider);
  }

  async deleteCredentialEntry(refId: string): Promise<void> {
    this.entries.delete(refId);
  }

  async setCredentialSecret(refId: string, secret: string): Promise<void> {
    this.secrets.set(refId, secret);
  }

  async getCredentialSecret(refId: string): Promise<string> {
    const value = this.secrets.get(refId);
    if (!value) {
      throw new Error(`Credential secret not found: ${refId}`);
    }

    return value;
  }

  async deleteCredentialSecret(refId: string): Promise<void> {
    this.secrets.delete(refId);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function generateRefId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `cred_${globalThis.crypto.randomUUID()}`;
  }
  return `cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class TauriCredentialVault implements CredentialVault {
  private readonly fallback = new InMemoryCredentialVault();
  private readonly useTauri: boolean;

  constructor(options?: { forceTauri?: boolean }) {
    this.useTauri = options?.forceTauri ?? hasTauriInvoke();
  }

  async upsertCredentialEntry(entry: CredentialEntry): Promise<void> {
    if (!this.useTauri) {
      await this.fallback.upsertCredentialEntry(entry);
      return;
    }

    await tauriInvoke<void>('credential_upsert_entry', {
      payload: { entry },
    });
  }

  async listCredentialEntries(provider?: string): Promise<CredentialEntry[]> {
    if (!this.useTauri) {
      return this.fallback.listCredentialEntries(provider);
    }

    return tauriInvoke<CredentialEntry[]>('credential_list_entries', {
      payload: { provider },
    });
  }

  async deleteCredentialEntry(refId: string): Promise<void> {
    if (!this.useTauri) {
      await this.fallback.deleteCredentialEntry(refId);
      return;
    }

    await tauriInvoke<void>('credential_delete_entry', {
      payload: { refId },
    });
  }

  async setCredentialSecret(refId: string, secret: string): Promise<void> {
    if (!this.useTauri) {
      await this.fallback.setCredentialSecret(refId, secret);
      return;
    }

    await tauriInvoke<void>('credential_set_secret', {
      payload: { refId, secret },
    });
  }

  async getCredentialSecret(refId: string): Promise<string> {
    if (!this.useTauri) {
      return this.fallback.getCredentialSecret(refId);
    }

    return tauriInvoke<string>('credential_get_secret', {
      payload: { refId },
    });
  }

  async deleteCredentialSecret(refId: string): Promise<void> {
    if (!this.useTauri) {
      await this.fallback.deleteCredentialSecret(refId);
      return;
    }

    await tauriInvoke<void>('credential_delete_secret', {
      payload: { refId },
    });
  }
}

export async function createCredential(
  vault: CredentialVault,
  input: {
    provider: string;
    profileId?: string;
    label?: string;
    secret: string;
    refId?: string;
  },
) {
  const entry: CredentialEntry = {
    refId: input.refId ?? generateRefId(),
    provider: input.provider,
    profileId: input.profileId ?? 'default',
    label: input.label ?? `${input.provider}:${input.profileId ?? 'default'}`,
    createdAt: nowIso(),
  };

  await vault.upsertCredentialEntry(entry);
  await vault.setCredentialSecret(entry.refId, input.secret);
  return entry;
}
