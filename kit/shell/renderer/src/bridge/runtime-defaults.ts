import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import { parseRuntimeDefaults, type RuntimeDefaults } from './types.js';

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'], {}, parseRuntimeDefaults);
}
