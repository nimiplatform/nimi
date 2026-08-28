import {
  createNimiLocalAppAgentConfigureRuntimeShell,
  type NimiLocalAppAgentConfigureRuntime,
  type NimiLocalAppAgentConfigureShell,
} from '../core/app/local-app-runtime-platform-configure.js';

/**
 * Exact generated Runtime methods required by the canonical Local App Agent
 * configuration surface. The transport is structural so Desktop and any
 * eligible protected App carrier can provide the same operation family.
 */
export type NimiRuntimeLocalAppAgentConfigureTransport = NimiLocalAppAgentConfigureRuntime;

/**
 * Adapts generated Runtime protobuf responses to the bounded, plain-data shell
 * consumed by `createNimiLocalAppAgentConfigureClient`.
 *
 * Runtime identity and private binding material are intentionally absent: the
 * only Agent selector crossing this boundary is the protected `agentHandle`.
 */
export function createNimiRuntimeLocalAppAgentConfigureShell(
  runtime: NimiRuntimeLocalAppAgentConfigureTransport,
): NimiLocalAppAgentConfigureShell {
  return createNimiLocalAppAgentConfigureRuntimeShell(runtime);
}
