import {
  requestControlPlaneJson,
  type ControlPlaneFetchImpl,
} from './http';
import { resolveControlPlaneRuntimeConfig } from './env';
import { CONTROL_PLANE_ENDPOINTS } from './endpoints';

export type RuntimeControlManifestVerifyInput = {
  modId: string;
  version: string;
  manifest: Record<string, unknown>;
  mode?: 'local-dev' | 'sideload';
};

export type RuntimeControlSignatureVerifyInput = {
  modId: string;
  version: string;
  signerId: string;
  signature: string;
  digest: string;
  mode?: 'local-dev' | 'sideload';
};

export type RuntimeControlGrantIssueInput = {
  modId: string;
  capabilities: string[];
  scope?: string;
  ttlSeconds?: number;
};

export type RuntimeControlGrantValidateInput = {
  grantId: string;
  token: string;
  modId?: string;
  capability?: string;
};

export type RuntimeControlAuditRecordInput = {
  modId?: string;
  stage?: string;
  eventType: string;
  decision?: 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';
  reasonCodes?: string[];
  payload?: Record<string, unknown>;
  occurredAt: string;
};

type RuntimeControlClientOptions = {
  controlPlaneBaseUrl?: string;
  accessToken?: string;
  fetchImpl?: ControlPlaneFetchImpl;
};

export class RuntimeControlPlaneClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: ControlPlaneFetchImpl;

  constructor(options: RuntimeControlClientOptions = {}) {
    const runtimeConfig = resolveControlPlaneRuntimeConfig({
      controlPlaneBaseUrl: options.controlPlaneBaseUrl,
      accessToken: options.accessToken,
    });
    this.baseUrl = runtimeConfig.baseUrl;
    this.accessToken = runtimeConfig.accessToken;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async verifyManifest(input: RuntimeControlManifestVerifyInput): Promise<{
    verified: boolean;
    issues: string[];
  }> {
    return this.post(CONTROL_PLANE_ENDPOINTS.verifyManifest, input, {
      required: false,
      fallback: {
        verified: input.mode === 'local-dev' || input.mode === 'sideload',
        issues: [],
      },
    });
  }

  async verifySignature(input: RuntimeControlSignatureVerifyInput): Promise<{
    verified: boolean;
    trustedSigner: boolean;
    reasonCodes: string[];
  }> {
    return this.post(CONTROL_PLANE_ENDPOINTS.verifySignature, input, {
      required: false,
      fallback: {
        verified: input.mode === 'local-dev' || input.mode === 'sideload',
        trustedSigner: false,
        reasonCodes: ['CONTROL_PLANE_UNAVAILABLE'],
      },
    });
  }

  async issueGrant(input: RuntimeControlGrantIssueInput): Promise<{
    grantId: string;
    token: string;
    capabilities: string[];
    expiresAt: string;
  } | null> {
    return this.post(CONTROL_PLANE_ENDPOINTS.issueGrant, input, {
      required: false,
      fallback: null,
    });
  }

  async validateGrant(input: RuntimeControlGrantValidateInput): Promise<{
    valid: boolean;
    reasonCodes: string[];
  }> {
    return this.post(CONTROL_PLANE_ENDPOINTS.validateGrant, input, {
      required: false,
      fallback: {
        valid: false,
        reasonCodes: ['CONTROL_PLANE_UNAVAILABLE'],
      },
    });
  }

  async fetchRevocations(from?: string): Promise<{
    items: Array<Record<string, unknown>>;
  }> {
    const query = from ? `?from=${encodeURIComponent(from)}` : '';
    return this.get(`${CONTROL_PLANE_ENDPOINTS.fetchRevocations}${query}`, {
      required: false,
      fallback: { items: [] },
    });
  }

  async syncAudit(input: {
    source: string;
    traceId?: string;
    records: RuntimeControlAuditRecordInput[];
  }): Promise<{ accepted: number }> {
    return this.post(CONTROL_PLANE_ENDPOINTS.syncAudit, input, {
      required: false,
      fallback: {
        accepted: input.records.length,
      },
    });
  }

  private async get<T>(
    path: string,
    options: {
      required: boolean;
      fallback: T;
    },
  ): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  private async post<T>(
    path: string,
    body: unknown,
    options: {
      required: boolean;
      fallback: T;
    },
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: {
      required: boolean;
      fallback: T;
    },
  ): Promise<T> {
    return requestControlPlaneJson<T>({
      fetchImpl: this.fetchImpl,
      baseUrl: this.baseUrl,
      accessToken: this.accessToken,
      method,
      path,
      body,
      required: options.required,
      fallback: options.fallback,
    });
  }
}
