import type { ModManifest } from '../contracts/types';

type ResolvedDependency = {
  id: string;
  version: string;
  order: number;
};

export class DependencyResolver {
  private readonly installed = new Map<string, string>();

  registerInstalled(modId: string, version: string): void {
    this.installed.set(modId, version);
  }

  unregisterInstalled(modId: string): void {
    this.installed.delete(modId);
  }

  resolve(manifest: ModManifest): {
    ok: boolean;
    reasonCodes: string[];
    resolved?: ResolvedDependency[];
  } {
    const dependencies = manifest.dependencies || [];

    if (dependencies.length === 0) {
      return { ok: true, reasonCodes: ['DEPENDENCY_RESOLVED'], resolved: [] };
    }

    const unique = new Set(dependencies);
    if (unique.size !== dependencies.length) {
      const duplicates = dependencies.filter(
        (dep, index) => dependencies.indexOf(dep) !== index,
      );
      return {
        ok: false,
        reasonCodes: [`DEPENDENCY_DUPLICATE:${duplicates.join(',')}`],
      };
    }

    if (dependencies.includes(manifest.id)) {
      return { ok: false, reasonCodes: ['DEPENDENCY_SELF_REFERENCE'] };
    }

    if (this.installed.size > 0) {
      const missing = dependencies.filter((dep) => !this.installed.has(dep));
      if (missing.length > 0) {
        return {
          ok: false,
          reasonCodes: [`DEPENDENCY_MISSING:${missing.join(',')}`],
        };
      }

      const cycle = this.detectCycle(manifest.id, dependencies);
      if (cycle) {
        return {
          ok: false,
          reasonCodes: [`DEPENDENCY_CIRCULAR:${cycle.join(' -> ')}`],
        };
      }
    }

    const resolved = this.topologicalSort(dependencies);

    return { ok: true, reasonCodes: ['DEPENDENCY_RESOLVED'], resolved };
  }

  private detectCycle(
    rootId: string,
    dependencies: string[],
    visited: Set<string> = new Set(),
  ): string[] | null {
    for (const dep of dependencies) {
      if (dep === rootId) {
        return [dep, rootId];
      }
      if (visited.has(dep)) {
        continue;
      }
      visited.add(dep);
    }
    return null;
  }

  private topologicalSort(dependencies: string[]): ResolvedDependency[] {
    return dependencies.map((dep, index) => ({
      id: dep,
      version: this.installed.get(dep) || 'unknown',
      order: index,
    }));
  }
}
