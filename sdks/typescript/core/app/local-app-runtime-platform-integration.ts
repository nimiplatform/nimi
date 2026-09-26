import type { ListIntegrationCatalogRequest, ListIntegrationCatalogResponse, ListIntegrationConnectionsRequest, ListIntegrationConnectionsResponse, InvokeIntegrationCallRequest, InvokeIntegrationCallResponse, GetIntegrationCallRequest, GetIntegrationCallResponse, ListIntegrationCallsRequest, ListIntegrationCallsResponse, CancelIntegrationCallRequest, CancelIntegrationCallResponse, RegisterIntegrationProviderRequest, RegisterIntegrationProviderResponse, UnregisterIntegrationProviderRequest, UnregisterIntegrationProviderResponse, PollIntegrationProviderRequest, PollIntegrationProviderResponse, CompleteIntegrationProviderRequest, CompleteIntegrationProviderResponse, GetIntegrationManagementRequest, GetIntegrationManagementResponse, PutIntegrationConnectionRequest, PutIntegrationConnectionResponse, RemoveIntegrationConnectionRequest, RemoveIntegrationConnectionResponse, SetIntegrationPermissionRequest, SetIntegrationPermissionResponse, IntegrationOperation, IntegrationTarget, IntegrationPermission, IntegrationConsumer, IntegrationCall, IntegrationProviderCall } from '../../core-generated/runtime-protobuf/runtime/v1/integration.js';
import type { RuntimeTypedClient } from '../../core-generated/runtime-typed-client.js';
import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiIntegrationOperation = Readonly<IntegrationOperation>;
export type NimiIntegrationTarget = Readonly<Omit<IntegrationTarget, 'operations' | 'permittedOperations'>> & { readonly operations: readonly NimiIntegrationOperation[]; readonly permittedOperations: readonly string[] };
export type NimiIntegrationPermission = Readonly<Omit<IntegrationPermission, 'operations' | 'consumer'>> & { readonly operations: readonly string[]; readonly consumer: NimiIntegrationConsumer | null };
export type NimiIntegrationConsumer = Readonly<IntegrationConsumer>;
export type NimiIntegrationCall = Readonly<Omit<IntegrationCall, 'createdAt' | 'updatedAt' | 'status'>> & { readonly createdAt: string | null; readonly updatedAt: string | null; readonly status: 'accepted' | 'completed' | 'failed' | 'canceled' | 'unconfirmed' };
export type NimiIntegrationProviderCall = Readonly<IntegrationProviderCall>;
export type NimiIntegrationProviderPoll = { readonly calls: readonly NimiIntegrationProviderCall[]; readonly canceledCallIds: readonly string[] };
export type NimiIntegrationManagement = { readonly targets: readonly NimiIntegrationTarget[]; readonly permissions: readonly NimiIntegrationPermission[]; readonly consumers: readonly NimiIntegrationConsumer[]; readonly calls: readonly NimiIntegrationCall[] };
export type NimiIntegrationInvokeIntegrationCallInput = Readonly<InvokeIntegrationCallRequest>;
export type NimiIntegrationGetIntegrationCallInput = Readonly<GetIntegrationCallRequest>;
export type NimiIntegrationListIntegrationCallsInput = Readonly<ListIntegrationCallsRequest>;
export type NimiIntegrationCancelIntegrationCallInput = Readonly<CancelIntegrationCallRequest>;
export type NimiIntegrationRegisterIntegrationProviderInput = Readonly<RegisterIntegrationProviderRequest>;
export type NimiIntegrationUnregisterIntegrationProviderInput = Readonly<UnregisterIntegrationProviderRequest>;
export type NimiIntegrationPollIntegrationProviderInput = Readonly<PollIntegrationProviderRequest>;
export type NimiIntegrationCompleteIntegrationProviderInput = Readonly<CompleteIntegrationProviderRequest>;
export type NimiIntegrationPutIntegrationConnectionInput = Readonly<PutIntegrationConnectionRequest>;
export type NimiIntegrationRemoveIntegrationConnectionInput = Readonly<RemoveIntegrationConnectionRequest>;
export type NimiIntegrationSetIntegrationPermissionInput = Readonly<SetIntegrationPermissionRequest>;
export type NimiLocalAppIntegrationShell = {
  readonly listCatalog: () => Promise<unknown>;
  readonly listConnections: () => Promise<unknown>;
  readonly invoke: (input: NimiIntegrationInvokeIntegrationCallInput) => Promise<unknown>;
  readonly getCall: (input: NimiIntegrationGetIntegrationCallInput) => Promise<unknown>;
  readonly listCalls: (input: NimiIntegrationListIntegrationCallsInput) => Promise<unknown>;
  readonly cancelCall: (input: NimiIntegrationCancelIntegrationCallInput) => Promise<unknown>;
  readonly registerProvider: (input: NimiIntegrationRegisterIntegrationProviderInput) => Promise<unknown>;
  readonly unregisterProvider: (input: NimiIntegrationUnregisterIntegrationProviderInput) => Promise<unknown>;
  readonly pollProvider: (input: NimiIntegrationPollIntegrationProviderInput) => Promise<unknown>;
  readonly completeProvider: (input: NimiIntegrationCompleteIntegrationProviderInput) => Promise<unknown>;
  readonly getManagement: () => Promise<unknown>;
  readonly putConnection: (input: NimiIntegrationPutIntegrationConnectionInput) => Promise<unknown>;
  readonly removeConnection: (input: NimiIntegrationRemoveIntegrationConnectionInput) => Promise<unknown>;
  readonly setPermission: (input: NimiIntegrationSetIntegrationPermissionInput) => Promise<unknown>;
};
export type NimiLocalAppIntegrationClient = {
  readonly listCatalog: () => Promise<readonly NimiIntegrationTarget[]>;
  readonly listConnections: () => Promise<readonly NimiIntegrationTarget[]>;
  readonly invoke: (input: NimiIntegrationInvokeIntegrationCallInput) => Promise<NimiIntegrationCall>;
  readonly getCall: (input: NimiIntegrationGetIntegrationCallInput) => Promise<NimiIntegrationCall>;
  readonly listCalls: (input: NimiIntegrationListIntegrationCallsInput) => Promise<readonly NimiIntegrationCall[]>;
  readonly cancelCall: (input: NimiIntegrationCancelIntegrationCallInput) => Promise<NimiIntegrationCall>;
  readonly registerProvider: (input: NimiIntegrationRegisterIntegrationProviderInput) => Promise<NimiIntegrationTarget>;
  readonly unregisterProvider: (input: NimiIntegrationUnregisterIntegrationProviderInput) => Promise<Readonly<UnregisterIntegrationProviderResponse>>;
  readonly pollProvider: (input: NimiIntegrationPollIntegrationProviderInput) => Promise<NimiIntegrationProviderPoll>;
  readonly completeProvider: (input: NimiIntegrationCompleteIntegrationProviderInput) => Promise<Readonly<CompleteIntegrationProviderResponse>>;
  readonly getManagement: () => Promise<NimiIntegrationManagement>;
  readonly putConnection: (input: NimiIntegrationPutIntegrationConnectionInput) => Promise<NimiIntegrationTarget>;
  readonly removeConnection: (input: NimiIntegrationRemoveIntegrationConnectionInput) => Promise<Readonly<RemoveIntegrationConnectionResponse>>;
  readonly setPermission: (input: NimiIntegrationSetIntegrationPermissionInput) => Promise<NimiIntegrationPermission>;
};
export type NimiLocalAppIntegrationMethod = keyof NimiLocalAppIntegrationShell;
const INPUT_KEYS: Record<NimiLocalAppIntegrationMethod, readonly string[]> = {"listCatalog": [], "listConnections": [], "invoke": ["targetRef", "operation", "inputJson"], "getCall": ["callId"], "listCalls": ["limit"], "cancelCall": ["callId"], "registerProvider": ["integrationId", "displayName", "operations", "skill"], "unregisterProvider": ["targetRef"], "pollProvider": ["waitMs"], "completeProvider": ["callId", "resultJson", "errorCode"], "getManagement": [], "putConnection": ["targetRef", "adapter", "endpoint", "displayName", "accountLabel", "secret"], "removeConnection": ["targetRef"], "setPermission": ["consumerRef", "targetRef", "operations"]};
export function validateNimiLocalAppIntegrationInput(method: NimiLocalAppIntegrationMethod, value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const input = record ? { ...record } : undefined;
  assertExactKeys(input, INPUT_KEYS[method], 'Integration input');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 33 * 1024 * 1024) return invalid();
  for (const key of INPUT_KEYS[method]) {
    if (key === 'limit' || key === 'waitMs') { const max = key === 'limit' ? 100 : 25000; if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > max) return invalid(); }
    else if (key === 'operations') {
      if (!Array.isArray(input[key]) || input[key].length > 128) return invalid();
      if (method === 'registerProvider') input[key] = input[key].map(v => operation(v, false));
      else { const names = input[key].map(v => text(v, 256, false)); if (new Set(names).size !== names.length) return invalid(); }
    } else { const bound = key === 'resultJson' ? 1024 * 1024 : key === 'inputJson' ? 256 * 1024 : key === 'skill' ? 32768 : key === 'secret' ? 16384 : key === 'endpoint' ? 4096 : 512; text(input[key], bound, ['skill','resultJson','errorCode','secret','endpoint','accountLabel'].includes(key) || (method === 'putConnection' && key === 'targetRef')); }
  }
  for (const key of ['inputJson', 'resultJson']) if (input[key]) { try { JSON.parse(String(input[key])); } catch { return invalid(); } }
  if (method === 'putConnection' && !['mcp','telegram'].includes(String(input.adapter))) return invalid();
  return input;
}
function invalid(): never { return localAppError('Integration input is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_integration_input'); }
function text(value: unknown, bound: number, empty = false, projection = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0') || new TextEncoder().encode(value).byteLength > bound) return projection ? localAppProjectionError('Integration text') : invalid();
  return value;
}
function list(value: unknown, max = 1000): unknown[] { if (!Array.isArray(value) || value.length > max) return localAppProjectionError('Integration list'); return value; }
function operation(value: unknown, projection = true): NimiIntegrationOperation {
  const row = asRecord(value); const keys = ['name','description','inputSchemaJson','outputSchemaJson','effect','supportsCancel','retryPolicy'];
  if (projection) assertExactProjectionKeys(row, keys, 'Integration operation'); else assertExactKeys(row, keys, 'Integration operation');
  for (const key of ['name','description','inputSchemaJson','outputSchemaJson']) text(row[key], key.endsWith('Json') ? 65536 : key === 'name' ? 128 : 4096, key === 'description', projection);
  if (!['read','write'].includes(String(row.effect)) || !['none','safe'].includes(String(row.retryPolicy)) || typeof row.supportsCancel !== 'boolean') return projection ? localAppProjectionError('Integration operation') : invalid();
  for (const key of ['inputSchemaJson','outputSchemaJson']) { try { const schema = JSON.parse(String(row[key])); if (typeof schema !== 'boolean' && !asRecord(schema)) throw new Error(); } catch { return projection ? localAppProjectionError('Integration schema') : invalid(); } }
  return Object.freeze({ ...row }) as NimiIntegrationOperation;
}
function target(value: unknown): NimiIntegrationTarget {
  const row = asRecord(value); assertExactProjectionKeys(row, ['targetRef','integrationId','displayName','accountLabel','kind','available','operations','skill','permittedOperations'], 'Integration target');
  for (const key of ['targetRef','integrationId','displayName','accountLabel','skill']) text(row[key], key === 'skill' ? 32768 : 512, ['skill','accountLabel'].includes(key), true);
  if (!['mcp','telegram','app'].includes(String(row.kind)) || typeof row.available !== 'boolean') return localAppProjectionError('Integration target');
  return Object.freeze({ ...row, operations: Object.freeze(list(row.operations,128).map(v => operation(v))), permittedOperations: Object.freeze(list(row.permittedOperations,128).map(v => text(v,256,false,true))) }) as NimiIntegrationTarget;
}
function call(value: unknown): NimiIntegrationCall {
  const row = asRecord(value); assertExactProjectionKeys(row, ['callId','targetRef','operation','status','resultJson','errorCode','consumerDisplayName','createdAt','updatedAt','targetDisplayName','accountLabel'], 'Integration call');
  for (const key of ['callId','targetRef','operation','resultJson','errorCode','consumerDisplayName','targetDisplayName','accountLabel']) text(row[key], key === 'resultJson' ? 1024 * 1024 : 512, ['resultJson','errorCode','consumerDisplayName','targetDisplayName','accountLabel'].includes(key), true);
  if (!['accepted','completed','failed','canceled','unconfirmed'].includes(String(row.status))) return localAppProjectionError('Integration call');
  if (row.resultJson) { try { JSON.parse(String(row.resultJson)); } catch { return localAppProjectionError('Integration result'); } }
  for (const key of ['createdAt','updatedAt']) if (row[key] !== null && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(String(row[key]))))) return localAppProjectionError('Integration timestamp');
  return Object.freeze({ ...row }) as NimiIntegrationCall;
}
function permission(value: unknown): NimiIntegrationPermission {
  const row = asRecord(value); assertExactProjectionKeys(row, ['consumerRef','targetRef','operations','consumer'], 'Integration permission');
  const description = row.consumer == null ? undefined : consumer(row.consumer);
  if (description && description.consumerRef !== row.consumerRef) return localAppProjectionError('Integration permission consumer');
  return Object.freeze({ consumerRef: text(row.consumerRef,512,false,true), targetRef: text(row.targetRef,512,false,true), operations: Object.freeze(list(row.operations,128).map(v => text(v,256,false,true))), consumer: description ?? null });
}
function consumer(value: unknown): NimiIntegrationConsumer {
  const row = asRecord(value);
  assertExactProjectionKeys(row, ['consumerRef','appId','displayName','sourceKind'], 'Integration consumer');
  if (!['development','installed','platform','unknown'].includes(String(row.sourceKind))) return localAppProjectionError('Integration consumer source');
  return Object.freeze({
    consumerRef: text(row.consumerRef,512,false,true),
    appId: text(row.appId,512,false,true),
    displayName: text(row.displayName,512,true,true),
    sourceKind: String(row.sourceKind),
  });
}
function project(method: NimiLocalAppIntegrationMethod, value: unknown): unknown {
  const row = asRecord(value);
  if (['listCatalog','listConnections'].includes(method)) { const key = method === 'listCatalog' ? 'targets' : 'connections'; assertExactProjectionKeys(row,[key],'Integration listing'); return Object.freeze(list(row[key]).map(target)); }
  if (['invoke','getCall','cancelCall'].includes(method)) { assertExactProjectionKeys(row,['call'],'Integration call response'); return call(row.call); }
  if (method === 'listCalls') { assertExactProjectionKeys(row,['calls'],'Integration history'); return Object.freeze(list(row.calls,100).map(call)); }
  if (['registerProvider','putConnection'].includes(method)) { const key = method === 'registerProvider' ? 'target' : 'connection'; assertExactProjectionKeys(row,[key],'Integration target response'); return target(row[key]); }
  if (['unregisterProvider','removeConnection','completeProvider'].includes(method)) { const key = method === 'completeProvider' ? 'accepted' : 'removed'; assertExactProjectionKeys(row,[key],'Integration acknowledgement'); if (typeof row[key] !== 'boolean') return localAppProjectionError('Integration acknowledgement'); return Object.freeze({[key]:row[key]}); }
  if (method === 'setPermission') { assertExactProjectionKeys(row,['permission'],'Integration permission response'); return permission(row.permission); }
  if (method === 'pollProvider') {
    assertExactProjectionKeys(row,['calls','canceledCallIds'],'Integration provider poll');
    return Object.freeze({ calls: Object.freeze(list(row.calls,64).map(v => { const item = asRecord(v); assertExactProjectionKeys(item,['callId','targetRef','operation','inputJson','consumerDisplayName'],'Integration provider call'); for (const key of Object.keys(item)) text(item[key],key === 'inputJson' ? 256*1024 : 512,key === 'consumerDisplayName',true); try { JSON.parse(String(item.inputJson)); } catch { return localAppProjectionError('Integration provider input'); } return Object.freeze({...item}); })), canceledCallIds: Object.freeze(list(row.canceledCallIds,1024).map(v => text(v,512,false,true))) });
  }
  assertExactProjectionKeys(row,['targets','permissions','consumers','calls'],'Integration management');
  return Object.freeze({ targets: Object.freeze(list(row.targets).map(target)), permissions: Object.freeze(list(row.permissions,4096).map(permission)), consumers: Object.freeze(list(row.consumers).map(consumer)), calls: Object.freeze(list(row.calls,100).map(call)) });
}
// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
export function createNimiLocalAppIntegrationClient(shell: NimiLocalAppIntegrationShell): NimiLocalAppIntegrationClient {
  const methods = Object.keys(INPUT_KEYS) as NimiLocalAppIntegrationMethod[];
  return Object.freeze(Object.fromEntries(methods.map(method => [method, async (input: unknown = {}) => {
    const valid = validateNimiLocalAppIntegrationInput(method,input);
    const result = await (shell[method] as (value: unknown) => Promise<unknown>)(valid);
    return project(method,result);
  }]))) as NimiLocalAppIntegrationClient;
}
export type NimiLocalAppIntegrationRuntime = Pick<RuntimeTypedClient, 'listIntegrationCatalog' | 'listIntegrationConnections' | 'invokeIntegrationCall' | 'getIntegrationCall' | 'listIntegrationCalls' | 'cancelIntegrationCall' | 'registerIntegrationProvider' | 'unregisterIntegrationProvider' | 'pollIntegrationProvider' | 'completeIntegrationProvider' | 'getIntegrationManagement' | 'putIntegrationConnection' | 'removeIntegrationConnection' | 'setIntegrationPermission'>;
export function createNimiLocalAppIntegrationRuntimeClient(runtime: NimiLocalAppIntegrationRuntime): NimiLocalAppIntegrationClient {
  return createNimiLocalAppIntegrationClient(createNimiLocalAppIntegrationRuntimeShell(runtime));
}
export function createNimiLocalAppIntegrationRuntimeShell(runtime: NimiLocalAppIntegrationRuntime): NimiLocalAppIntegrationShell {
  const wirePermission = (value: IntegrationPermission | undefined) => { if (!value) throw new Error('Runtime Integration permission is missing'); return { ...value, consumer: value.consumer ?? null }; };
  const timestamp = (value: { seconds: string; nanos: number } | undefined) => value ? new Date(Number(value.seconds) * 1000 + value.nanos / 1000000).toISOString() : null;
  const wireCall = (value: IntegrationCall | undefined) => { if (!value) throw new Error('Runtime Integration call is missing'); return { ...value, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) }; };
  return {
    listCatalog: async () => { return await runtime.listIntegrationCatalog({}); },
    listConnections: async () => { return await runtime.listIntegrationConnections({}); },
    invoke: async (input) => { const value = await runtime.invokeIntegrationCall(input); return { call: wireCall(value.call) }; },
    getCall: async (input) => { const value = await runtime.getIntegrationCall(input); return { call: wireCall(value.call) }; },
    listCalls: async (input) => { const value = await runtime.listIntegrationCalls(input); return { calls: value.calls.map(wireCall) }; },
    cancelCall: async (input) => { const value = await runtime.cancelIntegrationCall(input); return { call: wireCall(value.call) }; },
    registerProvider: async (input) => { return await runtime.registerIntegrationProvider(input); },
    unregisterProvider: async (input) => { return await runtime.unregisterIntegrationProvider(input); },
    pollProvider: async (input) => { return await runtime.pollIntegrationProvider(input); },
    completeProvider: async (input) => { return await runtime.completeIntegrationProvider(input); },
    getManagement: async () => { const value = await runtime.getIntegrationManagement({}); return { ...value, permissions: value.permissions.map(wirePermission), calls: value.calls.map(wireCall) }; },
    putConnection: async (input) => { return await runtime.putIntegrationConnection(input); },
    removeConnection: async (input) => { return await runtime.removeIntegrationConnection(input); },
    setPermission: async (input) => { const value = await runtime.setIntegrationPermission(input); return { permission: wirePermission(value.permission) }; },
  };
}
