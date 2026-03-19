import {
  requestControlPlaneJson,
  type ControlPlaneFetchImpl,
} from './http';
import type { JsonObject } from '../net/json';
import { resolveControlPlaneRuntimeConfig } from './env';
import { CONTROL_PLANE_ENDPOINTS } from './endpoints';

export type RuntimeControlManifestVerifyInput = {
  modId: string;
  version: string;
  manifest: JsonObject;
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
  payload?: JsonObject;
  occurredAt: string;
};

export type RuntimeControlManifestVerifyResult = {
  verified: boolean;
  issues: string[];
};

export type RuntimeControlSignatureVerifyResult = {
  verified: boolean;
  trustedSigner: boolean;
  reasonCodes: string[];
};

export type RuntimeControlGrantIssueResult = {
  grantId: string;
  token: string;
  capabilities: string[];
  expiresAt: string;
};

export type RuntimeControlGrantValidateResult = {
  valid: boolean;
  reasonCodes: string[];
};

export type RuntimeControlRevocationRecord = {
  grantId?: string;
  tokenId?: string;
  modId?: string;
  capability?: string;
  revokedAt?: string;
  reasonCode?: string;
  raw: JsonObject;
};

export type RuntimeControlRevocationListResult = {
  items: RuntimeControlRevocationRecord[];
};

export type RuntimeControlAuditSyncResult = {
  accepted: number;
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

  async verifyManifest(input: RuntimeControlManifestVerifyInput): Promise<RuntimeControlManifestVerifyResult> {
    return this.post(CONTROL_PLANE_ENDPOINTS.verifyManifest, input, {
      parse: parseManifestVerifyResult,
      required: false,
      fallback: {
        verified: input.mode === 'local-dev' || input.mode === 'sideload',
        issues: [],
      },
    });
  }

  async verifySignature(input: RuntimeControlSignatureVerifyInput): Promise<RuntimeControlSignatureVerifyResult> {
    return this.post(CONTROL_PLANE_ENDPOINTS.verifySignature, input, {
      parse: parseSignatureVerifyResult,
      required: false,
      fallback: {
        verified: input.mode === 'local-dev' || input.mode === 'sideload',
        trustedSigner: false,
        reasonCodes: ['CONTROL_PLANE_UNAVAILABLE'],
      },
    });
  }

  async issueGrant(input: RuntimeControlGrantIssueInput): Promise<RuntimeControlGrantIssueResult | null> {
    return this.post(CONTROL_PLANE_ENDPOINTS.issueGrant, input, {
      parse: parseGrantIssueResult,
      required: false,
      fallback: null,
    });
  }

  async validateGrant(input: RuntimeControlGrantValidateInput): Promise<RuntimeControlGrantValidateResult> {
    return this.post(CONTROL_PLANE_ENDPOINTS.validateGrant, input, {
      parse: parseGrantValidateResult,
      required: false,
      fallback: {
        valid: false,
        reasonCodes: ['CONTROL_PLANE_UNAVAILABLE'],
      },
    });
  }

  async fetchRevocations(from?: string): Promise<RuntimeControlRevocationListResult> {
    const query = from ? `?from=${encodeURIComponent(from)}` : '';
    return this.get(`${CONTROL_PLANE_ENDPOINTS.fetchRevocations}${query}`, {
      parse: parseRevocationListResult,
      required: false,
      fallback: { items: [] },
    });
  }

  async syncAudit(input: {
    source: string;
    traceId?: string;
    records: RuntimeControlAuditRecordInput[];
  }): Promise<RuntimeControlAuditSyncResult> {
    return this.post(CONTROL_PLANE_ENDPOINTS.syncAudit, input, {
      parse: parseAuditSyncResult,
      required: false,
      fallback: {
        accepted: input.records.length,
      },
    });
  }

  private async get<T>(
    path: string,
    options: {
      parse: (payload: JsonObject) => T | null;
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
      parse: (payload: JsonObject) => T | null;
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
      parse: (payload: JsonObject) => T | null;
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
      parse: options.parse,
      required: options.required,
      fallback: options.fallback,
    });
  }
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function readBoolean(value: unknown): boolean {
  return Boolean(value);
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function parseManifestVerifyResult(payload: JsonObject): RuntimeControlManifestVerifyResult {
  return {
    verified: readBoolean(payload.verified),
    issues: readStringArray(payload.issues),
  };
}

function parseSignatureVerifyResult(payload: JsonObject): RuntimeControlSignatureVerifyResult {
  return {
    verified: readBoolean(payload.verified),
    trustedSigner: readBoolean(payload.trustedSigner),
    reasonCodes: readStringArray(payload.reasonCodes),
  };
}

function parseGrantIssueResult(payload: JsonObject): RuntimeControlGrantIssueResult | null {
  const grantId = readString(payload.grantId);
  const token = readString(payload.token);
  const expiresAt = readString(payload.expiresAt);
  if (!grantId || !token || !expiresAt) {
    return null;
  }
  return {
    grantId,
    token,
    capabilities: readStringArray(payload.capabilities),
    expiresAt,
  };
}

function parseGrantValidateResult(payload: JsonObject): RuntimeControlGrantValidateResult {
  return {
    valid: readBoolean(payload.valid),
    reasonCodes: readStringArray(payload.reasonCodes),
  };
}

function parseRevocationRecord(payload: JsonObject): RuntimeControlRevocationRecord {
  return {
    grantId: readString(payload.grantId) || undefined,
    tokenId: readString(payload.tokenId) || undefined,
    modId: readString(payload.modId) || undefined,
    capability: readString(payload.capability) || undefined,
    revokedAt: readString(payload.revokedAt) || undefined,
    reasonCode: readString(payload.reasonCode) || undefined,
    raw: payload,
  };
}

function parseRevocationListResult(payload: JsonObject): RuntimeControlRevocationListResult {
  const rows = Array.isArray(payload.items) ? payload.items : [];
  return {
    items: rows
      .map((item) => asJsonObject(item))
      .filter((item): item is JsonObject => Boolean(item))
      .map((item) => parseRevocationRecord(item)),
  };
}

function parseAuditSyncResult(payload: JsonObject): RuntimeControlAuditSyncResult {
  return {
    accepted: readPositiveNumber(payload.accepted) ?? 0,
  };
}
