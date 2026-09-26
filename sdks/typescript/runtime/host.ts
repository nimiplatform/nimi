export * from './connector-auth-acquisition';

import { CoreClient, type CoreTransport } from '../core-client';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client';
export { getRuntimeWireCodec as getHostRuntimeWireCodec } from '../core-generated/runtime-wire-codecs';
// Exact request decoders for the verified Host's dynamic carrier boundary.
// These values are intentionally absent from the ordinary runtime entrypoint.
export { GetAppAIConfigRequest, OverwriteAppAIConfigRequest, ListAppAIConfigOptionsRequest } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
export { InvokeRealmUnaryRequest } from '../core-generated/runtime-protobuf/runtime/v1/account';
export type { ResolveDesktopAgentReferenceResponse } from '../core-generated/runtime-protobuf/runtime/v1/agent_service';

/** Host-only exact typed Runtime composition; renderer packages never receive this transport. */
export function createNimiHostRuntimeTypedClient(transport: CoreTransport): RuntimeTypedClient {
  return new RuntimeTypedClient(new CoreClient({
    transport,
    authMetadata: async () => ({
      protocolVersion: '1.0.0',
      participantProtocolVersion: '1.0.0',
      domain: 'runtime.rpc',
    }),
  }));
}
