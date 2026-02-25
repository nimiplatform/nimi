import type { RuntimeModFactory } from '../../types';
import {
  loadRuntimeModFactoryFromEntryPath,
  loadRuntimeModFactoryFromSource,
} from '../module-loader';

export type LoadSideloadFactoryResult =
  | {
    factory: RuntimeModFactory;
  }
  | {
    factory: null;
    reason: 'entry-not-found' | 'entry-read-failed' | 'factory-missing' | 'runtime-exception';
    error?: unknown;
  };

export async function loadSideloadRuntimeModFactory(input: {
  entryPath: string;
  readEntry: (entryPath: string) => Promise<string>;
}): Promise<LoadSideloadFactoryResult> {
  const normalizeErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error || '');

  let importError: unknown = null;
  try {
    const factory = await loadRuntimeModFactoryFromEntryPath(input.entryPath);
    if (factory) {
      return { factory };
    }
    return {
      factory: null,
      reason: 'factory-missing',
    };
  } catch (error) {
    importError = error;
  }

  let source = '';
  try {
    source = await input.readEntry(input.entryPath);
  } catch (error) {
    return {
      factory: null,
      reason: 'entry-read-failed',
      error,
    };
  }

  if (!source.trim()) {
    return {
      factory: null,
      reason: 'entry-not-found',
      error: importError,
    };
  }

  try {
    const factory = await loadRuntimeModFactoryFromSource(source, {
      entryPath: input.entryPath,
    });
    if (!factory) {
      return {
        factory: null,
        reason: 'factory-missing',
      };
    }
    return { factory };
  } catch (error) {
    const fallbackErrorMessage = normalizeErrorMessage(error);
    if (importError) {
      const entryImportMessage = normalizeErrorMessage(importError);
      return {
        factory: null,
        reason: 'runtime-exception',
        error: new Error(
          `entry-import-failed: ${entryImportMessage}; source-fallback-failed: ${fallbackErrorMessage}`,
        ),
      };
    }
    return {
      factory: null,
      reason: 'runtime-exception',
      error,
    };
  }
}
