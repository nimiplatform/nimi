export * from './connector-auth-acquisition';

import { CoreClient, type CoreTransport } from '../core-client';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client';

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
