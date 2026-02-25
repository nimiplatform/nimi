import type { ProviderAdapter } from '../providers';
import type { CapabilityRequest, ModelProfile } from '../types';
import { filterByCapability } from './capability-filter';
import { DEFAULT_TEMPLATES, mergeProfile, type ModelProfileOverlay, type ModelTemplateRule } from './templates';

export type ModelRegistryOptions = {
  cacheTtlMs?: number;
  now?: () => number;
  templates?: ModelTemplateRule[];
  overlays?: Record<string, ModelProfileOverlay>;
};

export type RefreshModelsOptions = {
  force?: boolean;
};

type ProviderCacheSnapshot = {
  fetchedAt: number;
  profileIds: string[];
};

const DEFAULT_CACHE_TTL_MS = 60_000;

export class ModelRegistry {
  private readonly profiles = new Map<string, ModelProfile>();
  private readonly providerCache = new Map<string, ProviderCacheSnapshot>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly templates: ModelTemplateRule[];
  private readonly overlays: Record<string, ModelProfileOverlay>;

  constructor(options?: ModelRegistryOptions) {
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options?.now ?? Date.now;
    this.templates = options?.templates ?? DEFAULT_TEMPLATES;
    this.overlays = options?.overlays ?? {};
  }

  register(profile: ModelProfile) {
    const normalized = this.applyTemplateAndOverlay(profile);
    this.profiles.set(normalized.id, normalized);
  }

  remove(profileId: string) {
    this.profiles.delete(profileId);
  }

  get(profileId: string) {
    return this.profiles.get(profileId);
  }

  list() {
    return Array.from(this.profiles.values());
  }

  listByProvider(providerType: ModelProfile['providerType']) {
    return this.list().filter((profile) => profile.providerType === providerType);
  }

  clear() {
    this.profiles.clear();
    this.providerCache.clear();
  }

  findByCapability(capability: CapabilityRequest['capability'], constraints?: Partial<CapabilityRequest>) {
    return filterByCapability(this.list(), capability, constraints);
  }

  async refreshModelsFromAdapter(adapter: ProviderAdapter, options?: RefreshModelsOptions): Promise<ModelProfile[]> {
    const cacheKey = this.cacheKeyForAdapter(adapter);
    const snapshot = this.providerCache.get(cacheKey);

    if (!options?.force && snapshot && this.now() - snapshot.fetchedAt < this.cacheTtlMs) {
      return snapshot.profileIds.map((id) => this.profiles.get(id)).filter(Boolean) as ModelProfile[];
    }

    const discovered = await adapter.listModels();
    const nextProfiles = discovered.map((profile) => this.applyTemplateAndOverlay(profile));
    const nextIds = new Set(nextProfiles.map((profile) => profile.id));
    const previousIds = snapshot?.profileIds ?? [];

    for (const profile of nextProfiles) {
      this.profiles.set(profile.id, profile);
    }

    for (const oldId of previousIds) {
      if (!nextIds.has(oldId)) {
        this.profiles.delete(oldId);
      }
    }

    this.providerCache.set(cacheKey, {
      fetchedAt: this.now(),
      profileIds: nextProfiles.map((profile) => profile.id),
    });

    return nextProfiles;
  }

  private cacheKeyForAdapter(adapter: ProviderAdapter) {
    return [adapter.type, adapter.config.name, adapter.config.endpoint].join('|');
  }

  private applyTemplateAndOverlay(profile: ModelProfile): ModelProfile {
    let next = profile;

    const template = this.matchTemplate(profile.model) ?? this.matchTemplate(profile.id);
    if (template) {
      next = mergeProfile(next, template.patch);
    }

    const overlays = this.collectOverlays(profile.model, profile.id);
    for (const overlay of overlays) {
      next = mergeProfile(next, overlay);
    }

    return next;
  }

  private matchTemplate(value: string) {
    const lowered = value.toLowerCase();
    return this.templates.find((template) => lowered.startsWith(template.prefix.toLowerCase()));
  }

  private prefixOverlaysFor(value: string) {
    const matched: Array<{ key: string; overlay: ModelProfileOverlay }> = [];
    for (const [pattern, overlay] of Object.entries(this.overlays)) {
      if (!pattern.endsWith('*')) {
        continue;
      }
      const prefix = pattern.slice(0, -1);
      if (value.startsWith(prefix)) {
        matched.push({ key: pattern, overlay });
      }
    }

    matched.sort((a, b) => a.key.length - b.key.length);
    return matched.map((item) => item.overlay);
  }

  private collectOverlays(model: string, id: string): ModelProfileOverlay[] {
    const merged: ModelProfileOverlay[] = [];

    merged.push(...this.prefixOverlaysFor(model));
    merged.push(...this.prefixOverlaysFor(id));

    if (this.overlays[model]) {
      merged.push(this.overlays[model]);
    }
    if (this.overlays[id]) {
      merged.push(this.overlays[id]);
    }

    return merged;
  }
}
