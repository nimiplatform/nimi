import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createSimulatorCssProfileVitePlugin } from '@nimiplatform/app-tools/simulator-css-profile';
import { defineConfig, type Plugin } from 'vite';
import { createSelectedDependencyQualifier } from './build/dependency-qualification.mjs';
import { createMaterializedIntegrityVerifier } from './build/materialized-integrity.mjs';
import { readSimulatorPublicEnvironment } from './build/public-env.mjs';

const simulatorRoot = path.dirname(fileURLToPath(import.meta.url));
const generatedRoot = path.join(simulatorRoot, '.generated');

interface ResolverTargetRow {
  readonly exportSubpath: string;
  readonly phase: 'types' | 'runtime' | 'style';
  readonly canonicalTarget: string;
  readonly fileDigest: string;
}

interface ResolverPackageRow {
  readonly name: string;
  readonly version: string;
  readonly role: 'mandatory-singleton' | 'app-specific';
  readonly lockIdentity: string;
  readonly packageJsonDigest: string;
  readonly targets: readonly ResolverTargetRow[];
}

interface ResolverEvidence {
  readonly tupleDigest: string;
  readonly packages: readonly ResolverPackageRow[];
}

function sha256File(filePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function packageSpecifier(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function canonicalPackageTarget(packageRow: ResolverPackageRow, target: ResolverTargetRow): string {
  const prefix = `package/${packageRow.name}@${packageRow.version}/`;
  if (!target.canonicalTarget.startsWith(prefix)) {
    throw new Error(`Runtime target ${target.canonicalTarget} escapes ${prefix}`);
  }
  const packageRoot = realpathSync(path.join(simulatorRoot, 'node_modules', ...packageRow.name.split('/')));
  const absolute = realpathSync(path.join(packageRoot, ...target.canonicalTarget.slice(prefix.length).split('/')));
  if (sha256File(absolute) !== target.fileDigest) {
    throw new Error(`Resolver target digest drift for ${packageSpecifier(packageRow.name, target.exportSubpath)}`);
  }
  return absolute;
}

function selectedSourcePlugin(): Plugin {
  const materializedIntegrity = createMaterializedIntegrityVerifier({ generatedRoot });
  materializedIntegrity.verifyAll();
  const buildMap = JSON.parse(readFileSync(path.join(generatedRoot, 'build-map.json'), 'utf8')) as Record<string, string>;
  const resolver = JSON.parse(
    readFileSync(path.join(generatedRoot, 'evidence', 'resolver.json'), 'utf8'),
  ) as ResolverEvidence;
  const dependencyQualifier = createSelectedDependencyQualifier({ simulatorRoot, resolver });
  const materializedRoot = path.join(generatedRoot, 'materialized');
  const packageTargets = new Map<string, {
    readonly absolute: string;
    readonly canonical: string;
    readonly packageName: string;
  }>();
  const governedPackages = new Set(resolver.packages.map((row) => row.name));
  for (const packageRow of resolver.packages) {
    for (const target of packageRow.targets) {
      if (target.phase === 'types') continue;
      const specifier = packageSpecifier(packageRow.name, target.exportSubpath);
      if (packageTargets.has(specifier)) throw new Error(`Duplicate runtime resolver target for ${specifier}`);
      packageTargets.set(specifier, {
        absolute: canonicalPackageTarget(packageRow, target),
        canonical: target.canonicalTarget,
        packageName: packageRow.name,
      });
    }
  }
  const usedPackageTargets = new Map<string, string>();
  const selectedEntries = new Map<string, Set<string>>();
  return {
    name: 'nimi-simulator-selected-source',
    enforce: 'pre',
    buildStart() {
      materializedIntegrity.verifyAll();
    },
    async resolveId(id, importer) {
      const canonicalPath = buildMap[id];
      if (canonicalPath) {
        const match = id.match(/^virtual:nimi-simulator\/([^/]+)\/(renderer|adapter|style)$/u);
        if (!match) throw new Error(`Invalid selected-source virtual ID ${id}`);
        const entries = selectedEntries.get(match[1]) ?? new Set<string>();
        entries.add(match[2]);
        selectedEntries.set(match[1], entries);
        return path.join(generatedRoot, 'materialized', ...canonicalPath.split('/'));
      }
      const packageTarget = packageTargets.get(id);
      if (packageTarget) {
        usedPackageTargets.set(id, packageTarget.canonical);
        const importerSelected = Boolean(importer
          && (path.resolve(importer.split(/[?#]/u, 1)[0]).startsWith(`${materializedRoot}${path.sep}`)
            || dependencyQualifier.isTaintedImporter(importer)));
        dependencyQualifier.markPackageTarget(
          packageTarget.packageName,
          packageTarget.absolute,
          importerSelected,
        );
        return packageTarget.absolute;
      }
      if (importer && dependencyQualifier.isTaintedImporter(importer)) {
        const resolved = await this.resolve(id, importer, { skipSelf: true });
        if (!resolved || resolved.external) {
          throw new Error(`SIM_DEPENDENCY_UNRESOLVED_EDGE:${id}`);
        }
        dependencyQualifier.markResolvedEdge(importer, resolved.id);
        return resolved;
      }
      const packageName = id.startsWith('@')
        ? id.split('/').slice(0, 2).join('/')
        : id.split('/')[0];
      if (governedPackages.has(packageName)) {
        throw new Error(`SIM_RESOLVER_UNQUALIFIED_IMPORT:${id}`);
      }
      const importerIsMaterialized = Boolean(importer
        && path.resolve(importer.split(/[?#]/u, 1)[0]).startsWith(`${materializedRoot}${path.sep}`));
      if (importerIsMaterialized
        && !id.startsWith('.')
        && !id.startsWith('/')
        && !id.startsWith('\0')
        && !id.startsWith('virtual:')) {
        throw new Error(`SIM_RESOLVER_UNQUALIFIED_IMPORT:${id}`);
      }
      return null;
    },
    transform(code, id) {
      materializedIntegrity.verifyTransform(code, id);
      dependencyQualifier.validateTransform(code, id);
      return null;
    },
    generateBundle() {
      materializedIntegrity.verifyAll();
      const selectedDependencyClosure = dependencyQualifier.finalize();
      const selectedModules = [...selectedEntries]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([moduleId, entries]) => ({
          moduleId,
          entries: [...entries].sort(),
        }));
      const finalGraph = {
        schema: 'nimi.simulator.final-graph/v1',
        resolverTupleDigest: resolver.tupleDigest,
        selectedModules,
        packageTargets: [...usedPackageTargets]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([specifier, canonicalTarget]) => ({ specifier, canonicalTarget })),
        selectedDependencyClosure,
      };
      this.emitFile({
        type: 'asset',
        fileName: 'evidence/final-graph.json',
        source: `${JSON.stringify(finalGraph, null, 2)}\n`,
      });
    },
  };
}

function selectedCssProfiles() {
  const buildMap = JSON.parse(readFileSync(path.join(generatedRoot, 'build-map.json'), 'utf8')) as Record<string, string>;
  return Object.entries(buildMap)
    .filter(([id]) => id.endsWith('/style'))
    .map(([id, canonicalStylePath]) => {
      const moduleId = id.split('/').at(-2);
      if (!moduleId) throw new Error(`Invalid selected style virtual ID: ${id}`);
      const report = JSON.parse(readFileSync(path.join(generatedRoot, 'evidence', 'app-tools', `${moduleId}.json`), 'utf8'));
      const stylePath = path.join(generatedRoot, 'materialized', ...canonicalStylePath.split('/'));
      const rootDir = path.resolve(
        path.dirname(stylePath),
        ...report.style.entry.split('/').slice(0, -1).map(() => '..'),
      );
      return { rootDir, report };
    });
}

export default defineConfig(() => {
  const publicEnvironment = readSimulatorPublicEnvironment();
  const resolver = JSON.parse(
    readFileSync(path.join(generatedRoot, 'evidence', 'resolver.json'), 'utf8'),
  ) as ResolverEvidence;
  return {
    root: simulatorRoot,
    envPrefix: '__NIMI_SIMULATOR_BROWSER_ENV_DISABLED__',
    define: {
      __NIMI_SIMULATOR_PUBLIC_CONFIG__: JSON.stringify(publicEnvironment),
    },
    plugins: [
      selectedSourcePlugin(),
      createSimulatorCssProfileVitePlugin({
        compilerRoot: simulatorRoot,
        foundationEntry: path.join(simulatorRoot, 'src/styles.css'),
        apps: selectedCssProfiles(),
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      dedupe: resolver.packages.map((row) => row.name),
    },
    build: {
      outDir: path.join(simulatorRoot, 'dist'),
      emptyOutDir: true,
      sourcemap: false,
      manifest: 'vite-manifest.json',
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
