import assert from 'node:assert/strict';
import test from 'node:test';
import * as grpc from '@grpc/grpc-js';
import { Runtime } from './index';
import { GetRuntimeHealthResponse, RuntimeHealthEvent } from '../core-generated/runtime-protobuf/runtime/v1/audit';

for (const mode of ['unary', 'stream'] as const) {
  for (const phase of ['headers', 'trailers'] as const) {
    test(`node-grpc ${mode} rejects incompatible ${phase} through the caller and keeps rejecting repeated versions`, async (t) => {
      const server = new grpc.Server();
      t.after(() => server.forceShutdown());
      let version = '1.0.0';
      const method = mode === 'unary' ? 'GetRuntimeHealth' : 'SubscribeRuntimeHealthEvents';
      const identity = (value: Uint8Array) => Buffer.from(value);
      server.addService({ invoke: {
        path: `/nimi.runtime.v1.RuntimeAuditService/${method}`,
        requestStream: false, responseStream: mode === 'stream',
        requestSerialize: identity, requestDeserialize: identity,
        responseSerialize: identity, responseDeserialize: identity,
      } }, { invoke(call: grpc.ServerWritableStream<Uint8Array, Uint8Array>, callback: grpc.sendUnaryData<Uint8Array>) {
        const metadata = new grpc.Metadata();
        metadata.set('x-nimi-runtime-version', version);
        if (phase === 'headers') call.sendMetadata(metadata);
        if (mode === 'stream') {
          call.write(RuntimeHealthEvent.toBinary(RuntimeHealthEvent.create({})));
          call.end(phase === 'trailers' ? metadata : undefined);
        } else {
          callback(null, GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create({})), phase === 'trailers' ? metadata : undefined);
        }
      } });
      const port = await new Promise<number>((resolve, reject) => {
        server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, value) => error ? reject(error) : resolve(value));
      });
      const runtime = new Runtime({ transport: { type: 'node-grpc', endpoint: `127.0.0.1:${port}` } });
      const invoke = async () => {
        if (mode === 'unary') await runtime.audit.getRuntimeHealth({});
        else for await (const _event of runtime.audit.subscribeRuntimeHealthEvents({})) { /* drain */ }
      };
      for (const invalid of ['1.0.0', '1.0.0', 'not-semver', 'not-semver']) {
        version = invalid;
        await assert.rejects(invoke(), { reasonCode: 'SDK_RUNTIME_VERSION_INCOMPATIBLE' });
      }
      version = '0.2.0';
      await invoke();
      assert.equal(runtime.versionCompatibility().compatible, true);
    });
  }
}
