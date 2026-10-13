import { NIMI_CHROME_COMMAND_EVENT, NIMI_CHROME_STATE_EVENT, NIMI_CHROME_NATIVE_COMMANDS, NIMI_STANDARD_SHELL_UI_COMMANDS, type NimiChromeBindRequest, type NimiChromeCommandEvent, type NimiChromeCommandRequest, type NimiChromeState, type NimiChromeStateSetRequest, type NimiChromeUnbindRequest } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import { listenShell } from './tauri-api.js';

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome-host
export function bindNimiAppChrome(payload: NimiChromeBindRequest): Promise<NimiChromeState> {
  return invokeChecked(NIMI_STANDARD_SHELL_UI_COMMANDS.chromeBind, { payload }, parseNimiChromeState);
}
export function updateNimiAppChromeState(payload: NimiChromeStateSetRequest): Promise<void> {
  return invokeChecked(NIMI_STANDARD_SHELL_UI_COMMANDS.chromeStateSet, { payload }, value => {
    const record = exact(value, ['updated']); if (record.updated !== true) throw new Error('Chrome state update was not acknowledged.');
  });
}
export function executeNimiAppChromeCommand(payload: NimiChromeCommandRequest): Promise<void> {
  return invokeChecked(NIMI_STANDARD_SHELL_UI_COMMANDS.chromeCommand, { payload }, value => {
    const record = exact(value, ['executed']); if (record.executed !== true) throw new Error('Chrome command was not executed.');
  });
}
export function unbindNimiAppChrome(payload: NimiChromeUnbindRequest): Promise<void> {
  return invokeChecked(NIMI_STANDARD_SHELL_UI_COMMANDS.chromeUnbind, { payload }, value => {
    const record = exact(value, ['released']); if (record.released !== true) throw new Error('Chrome binding was not released.');
  });
}
export async function subscribeNimiAppChromeCommands(listener: (event: NimiChromeCommandEvent) => void): Promise<() => void> {
  return listenShell(NIMI_CHROME_COMMAND_EVENT, event => {
    const record = exact(event.payload, ['generation', 'commandId']);
    if (typeof record.generation !== 'string' || !record.generation || typeof record.commandId !== 'string' || !record.commandId) throw new Error('Invalid chrome command event.');
    listener(record as NimiChromeCommandEvent);
  });
}
export async function subscribeNimiAppChromeState(listener: (state: NimiChromeState) => void): Promise<() => void> {
  return listenShell(NIMI_CHROME_STATE_EVENT, event => listener(parseNimiChromeState(event.payload)));
}
export function parseNimiChromeState(value: unknown): NimiChromeState {
  const record = exact(value, ['generation', 'menuPlacement', 'windowDrag', 'geometry', 'zoomFactor', 'fullscreen', 'nativeCommands', 'shortcuts']);
  if (typeof record.generation !== 'string' || !record.generation || (record.menuPlacement !== 'window' && record.menuPlacement !== 'system')
    || typeof record.windowDrag !== 'boolean' || typeof record.fullscreen !== 'boolean'
    || typeof record.zoomFactor !== 'number' || !Number.isFinite(record.zoomFactor) || record.zoomFactor <= 0) throw new Error('Invalid chrome state.');
  const geometry = exact(record.geometry, ['left', 'right', 'height']);
  if (Object.values(geometry).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new Error('Invalid chrome geometry.');
  if (!Array.isArray(record.nativeCommands) || new Set(record.nativeCommands).size !== record.nativeCommands.length
    || record.nativeCommands.some(command => !NIMI_CHROME_NATIVE_COMMANDS.includes(command))) throw new Error('Invalid native chrome commands.');
  if (!Array.isArray(record.shortcuts)) throw new Error('Invalid chrome shortcuts.');
  const ids = new Set<string>();
  for (const shortcut of record.shortcuts) {
    const fields = exact(shortcut, ['commandId', 'keys', 'owner']);
    if (typeof fields.commandId !== 'string' || !fields.commandId || ids.has(fields.commandId)
      || typeof fields.keys !== 'string' || !fields.keys || (fields.owner !== 'host' && fields.owner !== 'renderer' && fields.owner !== 'native-edit')) throw new Error('Invalid chrome shortcut.');
    ids.add(fields.commandId);
  }
  return record as NimiChromeState;
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid chrome response fields.');
  return value as Record<string, unknown>;
}
