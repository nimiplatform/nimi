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

  private capabilityMatches(pattern: string, capability: string): boolean {
    const normalizedPattern = String(pattern || '').trim();
    const normalizedCapability = String(capability || '').trim();
    if (!normalizedPattern || !normalizedCapability) {
      return false;
    }
    if (normalizedPattern === '*') {
      return true;
    }
    if (normalizedPattern === normalizedCapability) {
      return true;
    }
    if (normalizedPattern.includes('*')) {
      const escaped = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`).test(normalizedCapability);
    }
    return false;
  }

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
    let count = 0;
    for (const [id, profile] of this.profiles) {
      if (profile.modId === modId && profile.version === version) {
        profile.active = false;
        this.profiles.delete(id);
        count += 1;
      }
    }
    return count;
  }

  checkCapability(profileId: string, capability: string): {
    allowed: boolean;
    reasonCode: string;
  } {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return { allowed: false, reasonCode: 'SANDBOX_PROFILE_NOT_FOUND' };
    }
    if (!profile.active) {
      return { allowed: false, reasonCode: 'SANDBOX_PROFILE_INACTIVE' };
    }
    const matchedPattern = profile.capabilities.find((cap) => this.capabilityMatches(cap, capability));
    if (matchedPattern) {
      if (matchedPattern === '*') {
        return { allowed: true, reasonCode: 'SANDBOX_WILDCARD_GRANT' };
      }
      if (matchedPattern.includes('*')) {
        return { allowed: true, reasonCode: 'SANDBOX_CAPABILITY_PATTERN_MATCH' };
      }
      return { allowed: true, reasonCode: 'SANDBOX_CAPABILITY_GRANTED' };
    }
    return { allowed: false, reasonCode: 'SANDBOX_CAPABILITY_DENIED' };
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
