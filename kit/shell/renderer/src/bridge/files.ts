import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './types.js';

export type ShellFileDialogFilter = {
  readonly name: string;
  readonly extensions: readonly string[];
};

export type ShellFileDialogOpenPayload = {
  readonly kind: 'file' | 'directory';
  readonly title?: string;
  readonly filters?: readonly ShellFileDialogFilter[];
  readonly multiple?: boolean;
};

export type ShellFileDialogOpenResult = {
  readonly canceled: boolean;
  readonly paths: readonly string[];
};

export type ShellFileRevealResult = {
  readonly revealed: true;
  readonly path: string;
};

export type ShellExportSaveFilePayload = {
  readonly filename: string;
  readonly mimeType?: string;
  readonly dataBase64: string;
  readonly reveal?: boolean;
};

export type ShellExportSaveFileResult = {
  readonly artifactPath: string;
  readonly filename: string;
  readonly byteSize: number;
  readonly mimeType?: string;
};

export type ShellArtifactWritePayload = {
  readonly relativePath: string;
  readonly mimeType?: string;
  readonly dataBase64: string;
};

export type ShellArtifactWriteResult = {
  readonly path: string;
  readonly byteSize: number;
  readonly mimeType?: string;
};

export async function openShellFileDialog(payload: ShellFileDialogOpenPayload): Promise<ShellFileDialogOpenResult> {
  return invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
    { payload: { ...payload } },
    (value) => parseShellFileDialogOpenResult(value, NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']),
  );
}

export async function revealShellFile(path: string): Promise<ShellFileRevealResult> {
  return invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal'],
    { payload: { path } },
    (value) => parseShellFileRevealResult(value, NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']),
  );
}

export async function exportShellSaveFile(payload: ShellExportSaveFilePayload): Promise<ShellExportSaveFileResult> {
  return invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['export.saveFile'],
    { payload: { ...payload } },
    (value) => parseShellExportSaveFileResult(value, NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']),
  );
}

export async function writeShellArtifact(payload: ShellArtifactWritePayload): Promise<ShellArtifactWriteResult> {
  return invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['artifacts.write'],
    { payload: { ...payload } },
    (value) => parseShellArtifactWriteResult(value, NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']),
  );
}

function parseShellFileDialogOpenResult(value: unknown, command: string): ShellFileDialogOpenResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  if (!Array.isArray(record.paths)) {
    throw new Error(`${command}: paths must be an array`);
  }
  return {
    canceled: Boolean(record.canceled),
    paths: record.paths.map((entry, index) => parseRequiredString(entry, `paths[${index}]`, command)),
  };
}

function parseShellFileRevealResult(value: unknown, command: string): ShellFileRevealResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  if (record.revealed !== true) {
    throw new Error(`${command}: revealed must be true`);
  }
  return {
    revealed: true,
    path: parseRequiredString(record.path, 'path', command),
  };
}

function parseShellExportSaveFileResult(value: unknown, command: string): ShellExportSaveFileResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return {
    artifactPath: parseRequiredString(record.artifactPath, 'artifactPath', command),
    filename: parseRequiredString(record.filename, 'filename', command),
    byteSize: parseShellByteSize(record.byteSize, command),
    mimeType: parseOptionalString(record.mimeType),
  };
}

function parseShellArtifactWriteResult(value: unknown, command: string): ShellArtifactWriteResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  return {
    path: parseRequiredString(record.path, 'path', command),
    byteSize: parseShellByteSize(record.byteSize, command),
    mimeType: parseOptionalString(record.mimeType),
  };
}

function parseShellByteSize(value: unknown, command: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${command}: byteSize must be a non-negative number`);
  }
  return numeric;
}
