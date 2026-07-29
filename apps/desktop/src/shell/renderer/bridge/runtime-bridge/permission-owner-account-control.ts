import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { getRuntimeWireCodec } from '@nimiplatform/sdk/runtime/generated';
import type { NimiDesktopPermissionOwnerRuntimeClient } from '@nimiplatform/sdk/runtime';

const METHOD = {
  list: '/nimi.runtime.v1.RuntimeAccountService/ListLocalAppPermissionRequests',
  get: '/nimi.runtime.v1.RuntimeAccountService/GetLocalAppPermissionOwnerProjection',
  listProjections: '/nimi.runtime.v1.RuntimeAccountService/ListLocalAppPermissionOwnerProjections',
  decide: '/nimi.runtime.v1.RuntimeAccountService/DecideLocalAppPermission',
  revoke: '/nimi.runtime.v1.RuntimeAccountService/RevokeLocalAppPermission',
} as const;

async function accountControlUnary<Response>(methodId: string, request: unknown): Promise<Response> {
  const codec = getRuntimeWireCodec(methodId);
  const response = await invoke('runtime_account_permission_owner_unary', {
    methodId,
    requestBytesBase64: bytesToBase64(codec.encodeRequest(request)),
    timeoutMs: 10_000,
  });
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Desktop permission owner account-control response is invalid');
  }
  const responseBytesBase64 = String((response as Record<string, unknown>).responseBytesBase64 || '');
  return codec.decodeResponse(base64ToBytes(responseBytesBase64)) as Response;
}

type PermissionOwnerAccountControlClient = Omit<
  NimiDesktopPermissionOwnerRuntimeClient,
  'subscribeLocalAppPermissionRequests'
>;

export function createDesktopPermissionOwnerAccountControlClient(): PermissionOwnerAccountControlClient {
  return Object.freeze({
    listLocalAppPermissionRequests: (request) => accountControlUnary(METHOD.list, request),
    getLocalAppPermissionOwnerProjection: (request) => accountControlUnary(METHOD.get, request),
    listLocalAppPermissionOwnerProjections: (request) => accountControlUnary(METHOD.listProjections, request),
    decideLocalAppPermission: (request) => accountControlUnary(METHOD.decide, request),
    revokeLocalAppPermission: (request) => accountControlUnary(METHOD.revoke, request),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error('Desktop permission owner account-control bytes are invalid');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
