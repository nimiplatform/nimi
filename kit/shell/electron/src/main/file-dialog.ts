import { createElectronCapabilityUnavailableError } from './errors.js';
import { asRecord, normalizeRequiredToken, normalizeStringArray, normalizeText } from './paths.js';
import { NimiElectronShellHostError } from './types.js';
import type {
  NimiElectronFileDialogFilter,
  NimiElectronFileDialogOpenPayload,
  NimiElectronFileDialogOpenResult,
  NimiElectronStandardShellHost,
} from './types.js';

export async function openElectronShellFileDialog(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<NimiElectronFileDialogOpenResult> {
  const openFileDialog = host?.openFileDialog;
  if (!openFileDialog) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const parsedPayload = parseElectronFileDialogOpenPayload(payload, command);
  const result = asRecord(
    await openFileDialog(parsedPayload),
    `Electron file dialog command ${command} result must be an object`,
  );
  const paths = normalizeStringArray((result.paths ?? []) as readonly string[], 'paths', command);
  const protocolHost = host?.localAssetProtocolHost;
  if (protocolHost) {
    for (const selectedPath of paths) {
      await protocolHost.registerReadableFile(selectedPath);
    }
  }
  return {
    canceled: Boolean(result.canceled),
    paths,
  };
}

function parseElectronFileDialogOpenPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronFileDialogOpenPayload {
  const kind = normalizeText(payload.kind);
  if (kind !== 'file' && kind !== 'directory') {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron file dialog kind is not supported: ${kind || '<missing>'}`,
      reasonCode: 'electron-file-dialog-kind-invalid',
      actionHint: 'use_file_or_directory_dialog_kind',
      details: { command, kind },
    });
  }
  if (payload.multiple !== undefined && typeof payload.multiple !== 'boolean') {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron file dialog multiple flag must be a boolean',
      reasonCode: 'electron-file-dialog-multiple-invalid',
      actionHint: 'provide_boolean_multiple_flag',
      details: { command, valueType: typeof payload.multiple },
    });
  }
  return {
    kind,
    title: normalizeText(payload.title) || undefined,
    filters: parseElectronFileDialogFilters(payload.filters, command),
    multiple: payload.multiple,
  };
}

function parseElectronFileDialogFilters(
  value: unknown,
  command: string,
): readonly NimiElectronFileDialogFilter[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron file dialog filters must be an array',
      reasonCode: 'electron-file-dialog-filters-invalid',
      actionHint: 'provide_file_dialog_filter_array',
      details: { command, valueType: typeof value },
    });
  }
  return value.map((entry, index) => {
    const record = asRecord(entry, `Electron file dialog filter [${index}] must be an object`);
    return {
      name: normalizeRequiredToken(record.name, `filters[${index}].name`),
      extensions: normalizeStringArray(
        (record.extensions ?? []) as readonly string[],
        `filters[${index}].extensions`,
        command,
      ),
    };
  });
}
