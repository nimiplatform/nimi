import type { RuntimeModFactory } from '../../types';
import {
  loadRuntimeModFactoryFromEntryPath,
  loadRuntimeModFactoryFromSource,
} from '../module-loader';
import { ReasonCode } from '@nimiplatform/sdk/types';

export type LoadSideloadFactoryResult =
  | {
    factory: RuntimeModFactory;
  }
  | {
    factory: null;
    reason:
      | typeof ReasonCode.ENTRY_NOT_FOUND
      | typeof ReasonCode.ENTRY_READ_FAILED
      | typeof ReasonCode.FACTORY_MISSING
      | typeof ReasonCode.RUNTIME_EXCEPTION;
    error?: unknown;
  };

export async function loadSideloadRuntimeModFactory(input: {
  entryPath: string;
  readEntry: (entryPath: string) => Promise<string>;
}): Promise<LoadSideloadFactoryResult> {
  const normalizeErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error || '');

  let importError: unknown;
  try {
    const factory = await loadRuntimeModFactoryFromEntryPath(input.entryPath);
    if (factory) {
      return { factory };
    }
    return {
      factory: null,
      reason: ReasonCode.FACTORY_MISSING,
    };
  } catch (error) {
    importError = error;
  }

  let source: string;
  try {
    source = await input.readEntry(input.entryPath);
  } catch (error) {
    return {
      factory: null,
      reason: ReasonCode.ENTRY_READ_FAILED,
      error,
    };
  }

  if (!source.trim()) {
    return {
      factory: null,
      reason: ReasonCode.ENTRY_NOT_FOUND,
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
        reason: ReasonCode.FACTORY_MISSING,
      };
    }
    return { factory };
  } catch (error) {
    const fallbackErrorMessage = normalizeErrorMessage(error);
    if (importError) {
      const entryImportMessage = normalizeErrorMessage(importError);
      return {
        factory: null,
        reason: ReasonCode.RUNTIME_EXCEPTION,
        error: new Error(
          `entry-import-failed: ${entryImportMessage}; source-fallback-failed: ${fallbackErrorMessage}`,
        ),
      };
    }
    return {
      factory: null,
      reason: ReasonCode.RUNTIME_EXCEPTION,
      error,
    };
  }
}
