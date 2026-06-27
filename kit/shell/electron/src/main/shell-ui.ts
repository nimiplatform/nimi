import { createElectronCapabilityUnavailableError } from './errors.js';
import { asRecord, normalizeRequiredToken, normalizeText, standardNestedPayload } from './paths.js';
import { NimiElectronShellHostError } from './types.js';
import type {
  NimiElectronConfirmDialogPayload,
  NimiElectronConfirmDialogResult,
  NimiElectronIpcMainInvokeEvent,
  NimiElectronShellUiLevel,
  NimiElectronStandardShellHost,
} from './types.js';

export async function confirmElectronShellDialog(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<NimiElectronConfirmDialogResult> {
  const confirmDialog = input.host?.confirmDialog;
  if (!confirmDialog) {
    throw createElectronCapabilityUnavailableError(input.command);
  }
  const payload = parseElectronConfirmDialogPayload(
    standardNestedPayload(input.payload, input.command),
    input.command,
  );
  const result = await confirmDialog(payload, {
    command: input.command,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  const record = asRecord(result, `Electron shell UI command ${input.command} result must be an object`);
  return { confirmed: Boolean(record.confirmed) };
}

export async function startElectronWindowDrag(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<Record<string, never>> {
  const startWindowDrag = input.host?.startWindowDrag;
  if (!startWindowDrag) {
    throw createElectronCapabilityUnavailableError(input.command);
  }
  await startWindowDrag({
    command: input.command,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  return {};
}

export async function focusElectronMainWindow(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<Record<string, never>> {
  const focusMainWindow = input.host?.focusMainWindow;
  if (!focusMainWindow) {
    throw createElectronCapabilityUnavailableError(input.command);
  }
  await focusMainWindow({
    command: input.command,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  return {};
}

function parseElectronConfirmDialogPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronConfirmDialogPayload {
  const level = normalizeElectronShellUiLevel(payload.level, command);
  return {
    title: normalizeRequiredToken(payload.title, 'title'),
    description: normalizeRequiredToken(payload.description, 'description'),
    level,
  };
}

function normalizeElectronShellUiLevel(value: unknown, command: string): NimiElectronShellUiLevel | undefined {
  const level = normalizeText(value);
  if (!level) {
    return undefined;
  }
  if (level === 'info' || level === 'warning' || level === 'error') {
    return level;
  }
  throw new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: `Electron shell UI dialog level is not supported: ${level}`,
    reasonCode: 'electron-shell-ui-dialog-level-invalid',
    actionHint: 'use_info_warning_or_error_dialog_level',
    details: { command, level },
  });
}
