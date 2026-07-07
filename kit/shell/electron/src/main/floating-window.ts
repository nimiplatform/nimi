import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { asRecord } from './paths.js';
import type {
  NimiElectronFloatingWindowHost,
  NimiElectronIpcMainInvokeEvent,
  NimiElectronStandardShellHost,
} from './types.js';

const ELECTRON_FLOATING_WINDOW_COMMAND_METHODS: Readonly<Record<string, keyof NimiElectronFloatingWindowHost>> = {
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.setBounds']]: 'setBounds',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.setIgnoreCursorEvents']]: 'setIgnoreCursorEvents',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop']]: 'setAlwaysOnTop',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.hide']]: 'hide',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.close']]: 'close',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag']]: 'beginManualDrag',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.moveManualDrag']]: 'moveManualDrag',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea']]: 'constrainToVisibleArea',
};

export function isElectronFloatingWindowCommand(command: string): boolean {
  return command in ELECTRON_FLOATING_WINDOW_COMMAND_METHODS;
}

export async function dispatchElectronFloatingWindowCommand(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<Readonly<Record<string, unknown>>> {
  const methodName = ELECTRON_FLOATING_WINDOW_COMMAND_METHODS[input.command];
  const method = methodName ? input.host?.floatingWindow?.[methodName] : undefined;
  if (!method) {
    throw createElectronCapabilityUnavailableError(input.command);
  }
  const result = await method(input.payload, {
    command: input.command,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  if (result === undefined || result === null) {
    return {};
  }
  return asRecord(result, `Electron floating window command ${input.command} result must be an object`);
}
