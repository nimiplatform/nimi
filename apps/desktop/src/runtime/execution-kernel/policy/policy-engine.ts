import type { AccessMode } from '../contracts/types';
import { RuntimeControlPlaneClient } from '../../control-plane/client';
import { resolveCodegenCapabilityDecision } from '@runtime/mod/codegen/capability-catalog';

const HIGH_RISK = new Set([
  'network',
  'filesystem',
  'process',
]);

const PROTECTED_CAPABILITIES = new Set([
  'economy-write',
  'identity-write',
  'platform-cloud-write',
]);

export class PolicyEngine {
  constructor(private readonly controlPlane = new RuntimeControlPlaneClient()) {}

  async evaluate(input: {
    modId: string;
    mode: AccessMode;
    sourceType?: 'builtin' | 'injected' | 'sideload' | 'core' | 'codegen' | string;
    requestedCapabilities: string[];
    grantRef?: { grantId: string; token: string };
  }): Promise<{
    ok: boolean;
    reasonCodes: string[];
    grantedCapabilities: string[];
  }> {
    const requested = Array.from(new Set(input.requestedCapabilities || []));
    const sourceType = String(input.sourceType || '').trim().toLowerCase();
    const hasWildcard = requested.some((item) => item === '*' || item.endsWith(':*'));
    if (hasWildcard) {
      return {
        ok: false,
        reasonCodes: ['WILDCARD_CAPABILITY_NOT_ALLOWED'],
        grantedCapabilities: [],
      };
    }
    if (sourceType === 'codegen') {
      const decision = resolveCodegenCapabilityDecision(requested);
      const hardDenied = Array.from(new Set([...decision.denied, ...decision.unknown]));
      if (hardDenied.length > 0) {
        return {
          ok: false,
          reasonCodes: ['CODEGEN_CAPABILITY_DENIED', ...hardDenied.map((item) => `capability:${item}`)],
          grantedCapabilities: [],
        };
      }

      const hasConsentGrant = Boolean(input.grantRef?.grantId && input.grantRef?.token);
      if (decision.requiresConsent.length > 0 && !hasConsentGrant) {
        return {
          ok: false,
          reasonCodes: ['CODEGEN_T1_CONSENT_REQUIRED'],
          grantedCapabilities: decision.autoGranted,
        };
      }
    }

    const protectedRequested = requested.filter((item) => PROTECTED_CAPABILITIES.has(item));

    const hasHighRisk = requested.some((item) => HIGH_RISK.has(item));
    if (input.mode === 'sideload' && hasHighRisk) {
      return {
        ok: false,
        reasonCodes: ['HIGH_RISK_CAPABILITY_REQUIRES_LOCAL_CONSENT'],
        grantedCapabilities: [],
      };
    }

    if (protectedRequested.length > 0) {
      if (!input.grantRef?.grantId || !input.grantRef?.token) {
        return {
          ok: false,
          reasonCodes: ['CAPABILITY_GRANT_MISSING'],
          grantedCapabilities: requested.filter((item) => !PROTECTED_CAPABILITIES.has(item)),
        };
      }

      const validations = await Promise.all(
        protectedRequested.map((capability) =>
          this.controlPlane.validateGrant({
            grantId: input.grantRef!.grantId,
            token: input.grantRef!.token,
            modId: input.modId,
            capability,
          }),
        ),
      );
      const invalid = validations.find((item) => !item.valid);
      if (invalid) {
        return {
          ok: false,
          reasonCodes: invalid.reasonCodes.length > 0 ? invalid.reasonCodes : ['CAPABILITY_GRANT_INVALID'],
          grantedCapabilities: requested.filter((item) => !PROTECTED_CAPABILITIES.has(item)),
        };
      }
    }

    return {
      ok: true,
      reasonCodes: ['POLICY_ALLOW'],
      grantedCapabilities: requested,
    };
  }
}
