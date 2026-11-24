import type { NimiAppScope } from '@nimiplatform/kit/auth/app';

/** Wait for the result of one accepted call. Never re-invoke a write on a lost reply. */
export async function invokeSessionOperation(scope: NimiAppScope, targetRef: string, operation: string, input: object, signal: AbortSignal) {
  signal.throwIfAborted();
  const call = await scope.client.integration.invoke({ targetRef, operation, inputJson: JSON.stringify(input) });
  return readSessionCall(scope, call, signal);
}
export async function readSessionCall(scope: NimiAppScope, initial: Awaited<ReturnType<NimiAppScope['client']['integration']['getCall']>>, signal: AbortSignal) {
  let call = initial;
  const deadline = Date.now() + 30000;
  while (call.status === 'accepted') {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('The PC has not returned a result yet.');
    await new Promise(resolve => setTimeout(resolve, 350));
    signal.throwIfAborted();
    call = await scope.client.integration.getCall({ callId: call.callId });
  }
  signal.throwIfAborted();
  if (call.status !== 'completed') throw new Error(call.errorCode || `PC request ${call.status}.`);
  return call.resultJson;
}
