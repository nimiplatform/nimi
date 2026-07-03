import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { NimiElectronAIConfigStore } from './types.js';

export type NimiElectronFileAIConfigStoreOptions = {
  readonly dataRoot: string;
  readonly directoryName?: string;
  readonly storeLabel?: string;
};

export function createNimiElectronFileAIConfigStore(
  options: NimiElectronFileAIConfigStoreOptions,
): NimiElectronAIConfigStore {
  const dataRoot = requireDataRoot(options.dataRoot);
  const directoryName = normalizeSegment(options.directoryName || 'ai-config');
  const storeLabel = normalizeLabel(options.storeLabel || 'electron AI Config');
  return {
    get: async ({ scopeRef }) => {
      const filePath = fileAIConfigPath(dataRoot, directoryName, scopeRef);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      } catch (error) {
        if (isNotFoundError(error)) {
          return undefined;
        }
        throw error;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${storeLabel} store record is invalid: ${filePath}`);
      }
      const record = parsed as Record<string, unknown>;
      if (
        record.scopeRef !== scopeRef
        || !record.config
        || typeof record.config !== 'object'
        || Array.isArray(record.config)
      ) {
        throw new Error(`${storeLabel} store record does not match requested scope: ${filePath}`);
      }
      return record.config as Readonly<Record<string, unknown>>;
    },
    set: async ({ scopeRef, config }) => {
      const filePath = fileAIConfigPath(dataRoot, directoryName, scopeRef);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({
        schemaVersion: 1,
        scopeRef,
        config,
      }, null, 2), 'utf8');
      return config;
    },
  };
}

function fileAIConfigPath(dataRoot: string, directoryName: string, scopeRef: string): string {
  const encoded = Buffer.from(scopeRef, 'utf8').toString('base64url');
  return path.join(dataRoot, directoryName, `${encoded}.json`);
}

function requireDataRoot(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Electron file AI Config store requires dataRoot');
  }
  return path.resolve(normalized);
}

function normalizeSegment(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`Electron file AI Config store directoryName is invalid: ${value}`);
  }
  return normalized;
}

function normalizeLabel(value: string): string {
  return String(value || '').trim() || 'electron AI Config';
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
}
