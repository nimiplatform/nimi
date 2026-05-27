import { invoke } from './invoke.js';
import type {
  RuntimeBridgeDaemonStatus,
  RuntimeBridgeUnaryPayload,
  RuntimeBridgeUnaryResult,
  RuntimeBridgeStreamOpenPayload,
  RuntimeBridgeStreamOpenResult,
} from './types.js';

export async function getDaemonStatus(): Promise<RuntimeBridgeDaemonStatus> {
  return invoke<RuntimeBridgeDaemonStatus>('runtime_bridge_status');
}

export async function startDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invoke<RuntimeBridgeDaemonStatus>('runtime_bridge_start');
}

export async function stopDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invoke<RuntimeBridgeDaemonStatus>('runtime_bridge_stop');
}

export async function restartDaemon(): Promise<RuntimeBridgeDaemonStatus> {
  return invoke<RuntimeBridgeDaemonStatus>('runtime_bridge_restart');
}

export async function invokeUnary(
  payload: RuntimeBridgeUnaryPayload,
): Promise<RuntimeBridgeUnaryResult> {
  return invoke<RuntimeBridgeUnaryResult>('runtime_bridge_unary', payload as unknown as Record<string, unknown>);
}

export async function openStream(
  payload: RuntimeBridgeStreamOpenPayload,
): Promise<RuntimeBridgeStreamOpenResult> {
  return invoke<RuntimeBridgeStreamOpenResult>('runtime_bridge_stream_open', payload as unknown as Record<string, unknown>);
}

export async function closeStream(streamId: string): Promise<void> {
  await invoke('runtime_bridge_stream_close', { streamId });
}

export async function listenStreamEvents(
  eventName: string,
  handler: (event: { payload: unknown }) => void,
): Promise<() => void> {
  if (!window.__TAURI__?.event?.listen) {
    throw new Error('Tauri event API not available');
  }
  return window.__TAURI__.event.listen(eventName, handler);
}
