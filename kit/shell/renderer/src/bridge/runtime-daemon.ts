import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import {
  parseRuntimeBridgeConfigGetResult,
  parseRuntimeBridgeConfigSetResult,
  parseRuntimeBridgeDaemonStatus,
  type RuntimeBridgeConfigGetResult,
  type RuntimeBridgeConfigSetResult,
  type RuntimeBridgeDaemonStatus,
} from './types.js';

export async function getDaemonStatus(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'], {}, parseRuntimeBridgeDaemonStatus);
}

export async function startDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start'], {}, parseRuntimeBridgeDaemonStatus);
}

export async function stopDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.stop'], {}, parseRuntimeBridgeDaemonStatus);
}

export async function restartDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'], {}, parseRuntimeBridgeDaemonStatus);
}

export async function getDaemonConfig(): Promise<RuntimeBridgeConfigGetResult> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['config.get'], {}, parseRuntimeBridgeConfigGetResult);
}

export async function setDaemonConfig(configJson: string): Promise<RuntimeBridgeConfigSetResult> {
  return invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['config.set'],
    { payload: { configJson } },
    parseRuntimeBridgeConfigSetResult,
  );
}
