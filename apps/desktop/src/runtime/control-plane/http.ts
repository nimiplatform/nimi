import { parseJsonObject } from '@runtime/net/json';
import { toControlPlaneHttpError } from './error-map';

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
  required: boolean;
  fallback: T;
}): Promise<T> {
  const url = joinControlPlaneUrl(input.baseUrl, input.path);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (input.accessToken.trim()) {
    headers.Authorization = `Bearer ${input.accessToken.trim()}`;
  }

  try {
    const response = await input.fetchImpl(url, {
      method: input.method,
      headers,
      body: input.method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
    });

    if (!response.ok) {
      if (input.required) {
        const payload = await parseJsonObject(response);
        throw toControlPlaneHttpError({
          status: response.status,
          statusText: response.statusText,
          payload,
        });
      }
      return input.fallback;
    }

    const payload = await parseJsonObject(response);
    if (!payload) {
      return input.fallback;
    }
    return payload as unknown as T;
  } catch (error) {
    if (input.required) {
      throw error;
    }
    return input.fallback;
  }
}
