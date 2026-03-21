import {
  DEFAULT_SOURCE_ALLOWLIST,
  anyCapabilityMatches,
  normalizeCapabilityKey,
} from '../contracts/capabilities.js';
import type {
  HookSourceType,
  PermissionEvaluation,
} from '../contracts/types.js';

const PROTECTED_CAPABILITY_TOKENS = new Set([
  'economy-write',
  'identity-write',
  'platform-cloud-write',
  'audit.read.all',
  'meta.read.all',
]);

function dedupe(capabilities: string[]): string[] {
  return Array.from(
    new Set(
      (capabilities || [])
        .map((item) => normalizeCapabilityKey(item))
        .filter((item) => Boolean(item)),
    ),
  );
}

function isProtectedCapability(capabilityKey: string): boolean {
  const normalized = normalizeCapabilityKey(capabilityKey);
  if (!normalized) {
    return false;
  }
  if (PROTECTED_CAPABILITY_TOKENS.has(normalized)) {
    return true;
  }
  for (const token of PROTECTED_CAPABILITY_TOKENS) {
    if (normalized.startsWith(`${token}.`)) {
      return true;
    }
  }
  return false;
}

function toSourceType(value: string): HookSourceType {
  const normalized = normalizeCapabilityKey(value);
  if (normalized === 'builtin') return 'builtin';
  if (normalized === 'injected') return 'injected';
  if (normalized === 'core') return 'core';
  if (normalized === 'codegen') return 'codegen';
  return 'sideload';
}

export class PermissionGateway {
  private readonly baselines = new Map<string, string[]>();
  private readonly grants = new Map<string, string[]>();
  private readonly denials = new Map<string, string[]>();
  private readonly sourceTypes = new Map<string, HookSourceType>();

  setSourceType(modId: string, sourceType: HookSourceType): void {
    this.sourceTypes.set(modId, sourceType);
  }

  clearSourceType(modId: string): void {
    this.sourceTypes.delete(modId);
  }

  getSourceType(modId: string): HookSourceType {
    return this.sourceTypes.get(modId) || 'sideload';
  }

  setBaseline(modId: string, capabilities: string[]): void {
    this.baselines.set(modId, dedupe(capabilities));
  }

  clearBaseline(modId: string): void {
    this.baselines.delete(modId);
  }

  setGrant(modId: string, capabilities: string[]): void {
    this.grants.set(modId, dedupe(capabilities));
  }

  clearGrant(modId: string): void {
    this.grants.delete(modId);
  }

  setDenial(modId: string, capabilities: string[]): void {
    this.denials.set(modId, dedupe(capabilities));
  }

  clearDenial(modId: string): void {
    this.denials.delete(modId);
  }

  evaluate(input: {
    modId: string;
    sourceType?: HookSourceType;
    capabilityKey: string;
    resource?: string;
  }): PermissionEvaluation {
    const modId = String(input.modId || '').trim();
    const capabilityKey = normalizeCapabilityKey(input.capabilityKey);
    const resource = normalizeCapabilityKey(input.resource || capabilityKey);
    const sourceType = input.sourceType || this.getSourceType(modId);

    const denial = this.denials.get(modId) || [];
    if (
      anyCapabilityMatches(denial, capabilityKey)
      || anyCapabilityMatches(denial, resource)
    ) {
      return {
        allow: false,
        sourceType,
        capabilityKey,
        reasonCodes: ['EXPLICIT_DENY'],
      };
    }

    const baseline = this.baselines.get(modId) || [];
    if (
      anyCapabilityMatches(baseline, capabilityKey)
      || anyCapabilityMatches(baseline, resource)
    ) {
      return {
        allow: true,
        sourceType,
        capabilityKey,
        reasonCodes: ['BASELINE_ALLOW'],
      };
    }

    const grant = this.grants.get(modId) || [];
    if (
      anyCapabilityMatches(grant, capabilityKey)
      || anyCapabilityMatches(grant, resource)
    ) {
      return {
        allow: true,
        sourceType,
        capabilityKey,
        reasonCodes: ['GRANT_ALLOW'],
      };
    }

    if (isProtectedCapability(capabilityKey) || isProtectedCapability(resource)) {
      return {
        allow: false,
        sourceType,
        capabilityKey,
        reasonCodes: ['CAPABILITY_GRANT_MISSING'],
      };
    }

    const defaults = DEFAULT_SOURCE_ALLOWLIST[sourceType] || [];
    if (
      anyCapabilityMatches(defaults, capabilityKey)
      || anyCapabilityMatches(defaults, resource)
    ) {
      return {
        allow: true,
        sourceType,
        capabilityKey,
        reasonCodes: ['SOURCE_DEFAULT_ALLOW'],
      };
    }

    return {
      allow: false,
      sourceType,
      capabilityKey,
      reasonCodes: ['HOOK_PERMISSION_DENIED'],
    };
  }

  getDeclaration(modId: string): {
    modId: string;
    sourceType: HookSourceType;
    baseline: string[];
    grants: string[];
    denials: string[];
  } {
    return {
      modId,
      sourceType: toSourceType(this.getSourceType(modId)),
      baseline: [...(this.baselines.get(modId) || [])],
      grants: [...(this.grants.get(modId) || [])],
      denials: [...(this.denials.get(modId) || [])],
    };
  }

  listMods(): string[] {
    const mods = new Set<string>();
    for (const key of this.baselines.keys()) mods.add(key);
    for (const key of this.grants.keys()) mods.add(key);
    for (const key of this.denials.keys()) mods.add(key);
    for (const key of this.sourceTypes.keys()) mods.add(key);
    return [...mods];
  }
}
