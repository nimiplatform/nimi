import type { ModManifest } from '../contracts/types';

type ResolvedDependency = {
  id: string;
  version: string;
  order: number;
};

type InstalledDependency = {
  version: string;
  dependencies: string[];
};

export class DependencyResolver {
  private readonly installed = new Map<string, InstalledDependency>();

  registerInstalled(modId: string, version: string, dependencies: string[] = []): void {
    this.installed.set(modId, {
      version,
      dependencies: [...dependencies],
    });
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
  ): string[] | null {
    const visit = (
      currentDependencies: string[],
      trail: string[],
      visited: Set<string>,
    ): string[] | null => {
      for (const dep of currentDependencies) {
        if (dep === rootId) {
          return [...trail, dep];
        }
        if (visited.has(dep)) {
          continue;
        }
        const installed = this.installed.get(dep);
        if (!installed) {
          continue;
        }
        visited.add(dep);
        const cycle = visit(installed.dependencies, [...trail, dep], visited);
        visited.delete(dep);
        if (cycle) {
          return cycle;
        }
      }
      return null;
    };

    return visit(dependencies, [rootId], new Set<string>());
  }

  private topologicalSort(dependencies: string[]): ResolvedDependency[] {
    const directDependencies = new Set(dependencies);
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (dependencyId: string) => {
      if (visited.has(dependencyId) || visiting.has(dependencyId)) {
        return;
      }
      visiting.add(dependencyId);
      const installed = this.installed.get(dependencyId);
      for (const nextDependency of installed?.dependencies || []) {
        if (directDependencies.has(nextDependency)) {
          visit(nextDependency);
        }
      }
      visiting.delete(dependencyId);
      visited.add(dependencyId);
      ordered.push(dependencyId);
    };

    for (const dependency of dependencies) {
      visit(dependency);
    }

    return ordered.map((dep, index) => ({
      id: dep,
      version: this.installed.get(dep)?.version || 'unknown',
      order: index,
    }));
  }
}
