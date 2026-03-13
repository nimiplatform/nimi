export { hasTauriInvoke } from './runtime-bridge/env.js';
export { invoke, BridgeError } from './runtime-bridge/invoke.js';
export {
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  invokeUnary,
  openStream,
  closeStream,
  listenStreamEvents,
} from './runtime-bridge/runtime-daemon.js';
export type {
  RuntimeBridgeMetadata,
  RuntimeBridgeUnaryPayload,
  RuntimeBridgeUnaryResult,
  RuntimeBridgeStreamOpenPayload,
  RuntimeBridgeStreamOpenResult,
  RuntimeBridgeDaemonStatus,
  RuntimeBridgeStreamEvent,
  RuntimeBridgeErrorPayload,
} from './runtime-bridge/types.js';
