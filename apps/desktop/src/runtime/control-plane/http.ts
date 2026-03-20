import { parseJsonObject, type JsonObject } from '@runtime/net/json';
import {
  toControlPlaneContractError,
  toControlPlaneHttpError,
} from './error-map';

export type ControlPlaneFetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function joinControlPlaneUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function requestControlPlaneJson<T>(input: {
  fetchImpl: ControlPlaneFetchImpl;
  baseUrl: string;
  accessToken: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  parse: (payload: JsonObject) => T | null;
}): Promise<T> {
  const url = joinControlPlaneUrl(input.baseUrl, input.path);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (input.accessToken.trim()) {
    headers.Authorization = `Bearer ${input.accessToken.trim()}`;
  }

  const response = await input.fetchImpl(url, {
    method: input.method,
    headers,
    body: input.method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
  });

  if (!response.ok) {
    const payload = await parseJsonObject(response);
    throw toControlPlaneHttpError({
      status: response.status,
      statusText: response.statusText,
      payload,
    });
  }

  const payload = await parseJsonObject(response);
  if (!payload) {
    throw toControlPlaneContractError({
      reasonCode: 'control-plane/invalid-json',
      detail: `expected JSON object for ${input.method} ${input.path}`,
    });
  }
  const parsed = input.parse(payload);
  if (parsed === null) {
    throw toControlPlaneContractError({
      reasonCode: 'control-plane/invalid-response',
      detail: `invalid response shape for ${input.method} ${input.path}`,
    });
  }
  return parsed;
}
