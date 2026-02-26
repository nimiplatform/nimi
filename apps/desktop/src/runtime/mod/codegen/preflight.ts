import {
  resolveCodegenCapabilityDecision,
} from './capability-catalog';
import { ReasonCode } from '@nimiplatform/sdk/types';

export type CodegenPreflightViolation = {
  reasonCode: string;
  detail: string;
  severity: 'error' | 'warning';
};

export type CodegenPreflightInput = {
  modId: string;
  capabilities: string[];
  sourceCode: string;
  maxBundleBytes?: number;
  bundleBytesOverride?: number;
};

export type CodegenPreflightResult = {
  ok: boolean;
  reasonCode: string;
  violations: CodegenPreflightViolation[];
  autoGrantedCapabilities: string[];
  consentRequiredCapabilities: string[];
  deniedCapabilities: string[];
  unknownCapabilities: string[];
  bundleHash: string;
  bundleBytes: number;
};

type DenyPattern = {
  reasonCode: string;
  pattern: RegExp;
  detail: string;
};

const CODEGEN_DEFAULT_MAX_BUNDLE_BYTES = 512 * 1024;

const CODEGEN_DENY_PATTERNS: DenyPattern[] = [
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_EVAL_FORBIDDEN,
    pattern: /\beval\s*\(/,
    detail: 'eval() is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_NEW_FUNCTION_FORBIDDEN,
    pattern: /\bnew\s+Function\s*\(/,
    detail: 'new Function() is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_FETCH_FORBIDDEN,
    pattern: /\bfetch\s*\(/,
    detail: 'direct fetch() is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_XMLHTTPREQUEST_FORBIDDEN,
    pattern: /\bXMLHttpRequest\b/,
    detail: 'XMLHttpRequest is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_WEBSOCKET_FORBIDDEN,
    pattern: /\bWebSocket\s*\(/,
    detail: 'WebSocket is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_IMPORTSCRIPTS_FORBIDDEN,
    pattern: /\bimportScripts\s*\(/,
    detail: 'importScripts() is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_PROCESS_ENV_FORBIDDEN,
    pattern: /\bprocess\.env\b/,
    detail: 'process.env is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_REQUIRE_FORBIDDEN,
    pattern: /\brequire\s*\(/,
    detail: 'require() is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_LOCALSTORAGE_FORBIDDEN,
    pattern: /\blocalStorage\b/,
    detail: 'localStorage direct access is forbidden in codegen mods',
  },
  {
    reasonCode: ReasonCode.CODEGEN_PATTERN_HOST_IMPORT_FORBIDDEN,
    pattern: /@nimiplatform\/mod-sdk\/host/,
    detail: '@nimiplatform/sdk/mod/host import is forbidden in codegen mods',
  },
];

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = (hash >>> 0).toString(16).padStart(8, '0');
  return `fnv1a32:${normalized}`;
}

function estimateBundleBytes(sourceCode: string): number {
  return new TextEncoder().encode(sourceCode).length;
}

function collectPatternViolations(sourceCode: string): CodegenPreflightViolation[] {
  const violations: CodegenPreflightViolation[] = [];
  for (const rule of CODEGEN_DENY_PATTERNS) {
    if (!rule.pattern.test(sourceCode)) {
      continue;
    }
    violations.push({
      reasonCode: rule.reasonCode,
      detail: rule.detail,
      severity: 'error',
    });
  }
  return violations;
}

function summarizeReasonCode(violations: CodegenPreflightViolation[]): string {
  const firstError = violations.find((item) => item.severity === 'error');
  if (firstError) {
    return firstError.reasonCode;
  }
  return 'ACTION_EXECUTED';
}

export function preflightCodegenBundle(input: CodegenPreflightInput): CodegenPreflightResult {
  const sourceCode = String(input.sourceCode || '');
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const maxBundleBytes = input.maxBundleBytes && input.maxBundleBytes > 0
    ? input.maxBundleBytes
    : CODEGEN_DEFAULT_MAX_BUNDLE_BYTES;

  const violations: CodegenPreflightViolation[] = [];
  if (!String(input.modId || '').trim()) {
    violations.push({
      reasonCode: ReasonCode.CODEGEN_MOD_ID_REQUIRED,
      detail: 'modId is required for codegen preflight',
      severity: 'error',
    });
  }

  const capabilityDecision = resolveCodegenCapabilityDecision(capabilities);
  if (capabilityDecision.denied.length > 0) {
    violations.push({
      reasonCode: ReasonCode.CODEGEN_CAPABILITY_DENIED,
      detail: `T2 capabilities are forbidden: ${capabilityDecision.denied.join(', ')}`,
      severity: 'error',
    });
  }
  if (capabilityDecision.unknown.length > 0) {
    violations.push({
      reasonCode: ReasonCode.CODEGEN_CAPABILITY_UNKNOWN,
      detail: `unknown capabilities are forbidden in V1: ${capabilityDecision.unknown.join(', ')}`,
      severity: 'error',
    });
  }
  if (capabilityDecision.requiresConsent.length > 0) {
    violations.push({
      reasonCode: ReasonCode.CODEGEN_T1_CONSENT_REQUIRED,
      detail: `consent required for: ${capabilityDecision.requiresConsent.join(', ')}`,
      severity: 'warning',
    });
  }

  violations.push(...collectPatternViolations(sourceCode));

  const bundleBytes = input.bundleBytesOverride && input.bundleBytesOverride > 0
    ? input.bundleBytesOverride
    : estimateBundleBytes(sourceCode);
  if (bundleBytes > maxBundleBytes) {
    violations.push({
      reasonCode: ReasonCode.CODEGEN_BUNDLE_TOO_LARGE,
      detail: `bundle exceeds limit ${bundleBytes}/${maxBundleBytes} bytes`,
      severity: 'error',
    });
  }

  const reasonCode = summarizeReasonCode(violations);
  const ok = !violations.some((item) => item.severity === 'error');

  return {
    ok,
    reasonCode,
    violations,
    autoGrantedCapabilities: capabilityDecision.autoGranted,
    consentRequiredCapabilities: capabilityDecision.requiresConsent,
    deniedCapabilities: capabilityDecision.denied,
    unknownCapabilities: capabilityDecision.unknown,
    bundleHash: stableHash(sourceCode),
    bundleBytes,
  };
}
