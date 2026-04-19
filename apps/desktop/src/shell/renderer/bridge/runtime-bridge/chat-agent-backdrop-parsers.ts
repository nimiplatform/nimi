import {
  assertRecord,
  parseRequiredString,
} from './shared.js';
import type {
  DesktopAgentBackdropBindingRecord,
  DesktopAgentBackdropImportInput,
} from './chat-agent-backdrop-types.js';

function parseFiniteInteger(value: unknown, fieldName: string, errorPrefix: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${errorPrefix}: ${fieldName} must be an integer`);
  }
  return numeric;
}

export function parseDesktopAgentBackdropBindingRecord(value: unknown): DesktopAgentBackdropBindingRecord {
  const record = assertRecord(value, 'desktop agent backdrop binding is invalid');
  return {
    agentId: parseRequiredString(record.agentId, 'agentId', 'desktop agent backdrop binding'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'desktop agent backdrop binding'),
    sourceFilename: parseRequiredString(record.sourceFilename, 'sourceFilename', 'desktop agent backdrop binding'),
    storedPath: parseRequiredString(record.storedPath, 'storedPath', 'desktop agent backdrop binding'),
    fileUrl: parseRequiredString(record.fileUrl, 'fileUrl', 'desktop agent backdrop binding'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'desktop agent backdrop binding'),
  };
}

export function parseDesktopAgentBackdropImportInput(input: DesktopAgentBackdropImportInput): DesktopAgentBackdropImportInput {
  return {
    agentId: parseRequiredString(input.agentId, 'agentId', 'desktop agent backdrop import input'),
    sourcePath: parseRequiredString(input.sourcePath, 'sourcePath', 'desktop agent backdrop import input'),
    importedAtMs: input.importedAtMs == null
      ? null
      : parseFiniteInteger(input.importedAtMs, 'importedAtMs', 'desktop agent backdrop import input'),
  };
}
