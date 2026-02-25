type LoadedInstance = {
  instanceId: string;
  modId: string;
  version: string;
  sandboxProfileId: string;
  grantedCapabilities: string[];
  loadedAt: string;
  status: 'loaded' | 'unloaded' | 'error';
};

export class ModuleLoader {
  private readonly instances = new Map<string, LoadedInstance>();

  load(input: {
    modId: string;
    version: string;
    sandboxProfileId: string;
    grantedCapabilities: string[];
  }): {
    ok: boolean;
    instanceId: string;
    reasonCodes?: string[];
  } {
    const key = `${input.modId}@${input.version}`;
    const existing = this.instances.get(key);
    if (existing && existing.status === 'loaded') {
      return {
        ok: true,
        instanceId: existing.instanceId,
        reasonCodes: ['ALREADY_LOADED'],
      };
    }

    if (!input.modId || !input.version) {
      return {
        ok: false,
        instanceId: '',
        reasonCodes: ['LOAD_INVALID_INPUT'],
      };
    }

    if (!input.sandboxProfileId) {
      return {
        ok: false,
        instanceId: '',
        reasonCodes: ['LOAD_NO_SANDBOX_PROFILE'],
      };
    }

    const instanceId = `instance:${input.modId}:${input.version}:${Date.now().toString(36)}`;
    const instance: LoadedInstance = {
      instanceId,
      modId: input.modId,
      version: input.version,
      sandboxProfileId: input.sandboxProfileId,
      grantedCapabilities: [...input.grantedCapabilities],
      loadedAt: new Date().toISOString(),
      status: 'loaded',
    };
    this.instances.set(key, instance);

    return { ok: true, instanceId };
  }

  unload(modId: string, version: string): boolean {
    const key = `${modId}@${version}`;
    const instance = this.instances.get(key);
    if (!instance) {
      return false;
    }
    instance.status = 'unloaded';
    this.instances.delete(key);
    return true;
  }

  getInstance(modId: string, version: string): LoadedInstance | undefined {
    return this.instances.get(`${modId}@${version}`);
  }

  isLoaded(modId: string, version: string): boolean {
    const instance = this.instances.get(`${modId}@${version}`);
    return instance?.status === 'loaded';
  }

  listLoaded(): LoadedInstance[] {
    return Array.from(this.instances.values()).filter(
      (instance) => instance.status === 'loaded',
    );
  }
}
