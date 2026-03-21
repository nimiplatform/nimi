import { ReasonCode } from '@nimiplatform/sdk/types';
import { capabilityMatches } from '../../hook/contracts/capabilities.js';
type SandboxProfile = {
  profileId: string;
  modId: string;
  version: string;
  capabilities: string[];
  createdAt: string;
  active: boolean;
};

export class SandboxManager {
  private readonly profiles = new Map<string, SandboxProfile>();

  create(input: { modId: string; version: string; capabilities: string[] }): string {
    const profileId = `sandbox:${input.modId}:${input.version}:${Date.now().toString(36)}`;
    this.profiles.set(profileId, {
      profileId,
      modId: input.modId,
      version: input.version,
      capabilities: [...input.capabilities],
      createdAt: new Date().toISOString(),
      active: true,
    });
    return profileId;
  }

  get(profileId: string): SandboxProfile | undefined {
    return this.profiles.get(profileId);
  }

  destroy(profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return false;
    }
    profile.active = false;
    this.profiles.delete(profileId);
    return true;
  }

  destroyByMod(modId: string, version: string): number {
    const toDelete: string[] = [];
    for (const [id, profile] of this.profiles) {
      if (profile.modId === modId && profile.version === version) {
        profile.active = false;
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.profiles.delete(id);
    }
    return toDelete.length;
  }

  checkCapability(profileId: string, capability: string): {
    allowed: boolean;
    reasonCode: string;
  } {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return { allowed: false, reasonCode: ReasonCode.SANDBOX_PROFILE_NOT_FOUND };
    }
    if (!profile.active) {
      return { allowed: false, reasonCode: ReasonCode.SANDBOX_PROFILE_INACTIVE };
    }
    const matchedPattern = profile.capabilities.find((cap) => capabilityMatches(cap, capability));
    if (matchedPattern) {
      if (matchedPattern === '*') {
        return { allowed: true, reasonCode: ReasonCode.SANDBOX_WILDCARD_GRANT };
      }
      if (matchedPattern.includes('*')) {
        return { allowed: true, reasonCode: ReasonCode.SANDBOX_CAPABILITY_PATTERN_MATCH };
      }
      return { allowed: true, reasonCode: ReasonCode.SANDBOX_CAPABILITY_GRANTED };
    }
    return { allowed: false, reasonCode: ReasonCode.SANDBOX_CAPABILITY_DENIED };
  }

  listActive(): SandboxProfile[] {
    return Array.from(this.profiles.values()).filter((p) => p.active);
  }

  listByMod(modId: string): SandboxProfile[] {
    return Array.from(this.profiles.values()).filter(
      (p) => p.modId === modId,
    );
  }
}
