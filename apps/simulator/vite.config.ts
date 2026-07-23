import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createSimulatorCssProfileVitePlugin } from '@nimiplatform/app-tools/simulator-css-profile';
import { isSimulatorStaticAssetPath } from '@nimiplatform/app-tools/simulator-conformance';
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
  readonly moduleFormat?: 'esm' | 'commonjs';
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
  readonly devInteropImports: readonly string[];
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

function selectedSourcePlugin({ qualifyDependencyClosure }: { readonly qualifyDependencyClosure: boolean }): Plugin {
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
        if (!qualifyDependencyClosure) {
          return null;
        }
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
      if (qualifyDependencyClosure && importer && dependencyQualifier.isTaintedImporter(importer)) {
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
      if (isSimulatorStaticAssetPath(id.split(/[?#]/u, 1)[0])) return null;
      materializedIntegrity.verifyTransform(code, id);
      if (qualifyDependencyClosure) dependencyQualifier.validateTransform(code, id);
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

function controlledDevWithoutViteClient(): Plugin {
  const stripCssHmr = (code: string, id: string): string => {
    if (!code.includes('from "/@vite/client"')
      || !code.includes('const __vite__css = ')
      || !code.includes('__vite__updateStyle(__vite__id, __vite__css)')) return code;
    const withoutClient = code
      .replace(/^import \{ createHotContext[^\n]+from "\/@vite\/client"\n/u, '')
      .replace(
        '__vite__updateStyle(__vite__id, __vite__css)',
        'const __nimiStyle = document.createElement("style"); __nimiStyle.dataset.nimiControlledDevStyle = __vite__id; __nimiStyle.textContent = __vite__css; document.head.appendChild(__nimiStyle)',
      )
      .replace(/\nimport\.meta\.hot\.accept\(\)\nimport\.meta\.hot\.prune\([^\n]+\)\s*$/u, '\n');
    if (withoutClient.includes('/@vite/client') || withoutClient.includes('import.meta.hot')) {
      throw new Error(`SIM_DEV_CSS_HMR_TRANSFORM_DRIFT:${id}`);
    }
    return withoutClient;
  };
  const stripModuleHmr = (code: string): string => code
    .replace(
      /import \{ injectQuery as __vite__injectQuery \} from "\/@vite\/client";/gu,
      'const __vite__injectQuery = (url, query) => { if (url[0] !== "." && url[0] !== "/") return url; const pathname = url.replace(/[?#].*$/, ""); const parsed = new URL(url, "http://vite.dev"); return `${pathname}?${query}${parsed.search ? `&${parsed.search.slice(1)}` : ""}${parsed.hash || ""}`; };',
    )
    .replace(
      /import \{ createHotContext as __vite__createHotContext \} from "\/@vite\/client";import\.meta\.hot = __vite__createHotContext\([^;]+\);/gu,
      '',
    );
  return {
    name: 'nimi-simulator-controlled-dev-no-vite-client',
    apply: 'serve',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const withoutClient = html.replace(/\s*<script type="module" src="\/@vite\/client"><\/script>\s*/u, '\n');
        const withSelectedSourceAssets = withoutClient.replace(
          "img-src 'none'",
          "img-src 'self' data:",
        );
        if (!withSelectedSourceAssets.includes("connect-src 'none'")) {
          throw new Error('SIM_DEV_CSP_FLOOR_DRIFT');
        }
        return withSelectedSourceAssets;
      },
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (!/\.(?:css|js|jsx|mjs|ts|tsx)$/u.test(pathname)
          && !pathname.startsWith('/node_modules/.vite/deps/')) {
          return next();
        }
        const chunks: Buffer[] = [];
        const originalWrite = response.write.bind(response);
        const originalEnd = response.end.bind(response);
        response.write = ((chunk: unknown) => {
          if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        }) as typeof response.write;
        response.end = ((chunk?: unknown) => {
          if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          try {
            const source = Buffer.concat(chunks).toString('utf8');
            const transformed = stripModuleHmr(stripCssHmr(source, pathname));
            response.removeHeader('content-length');
            return originalEnd(transformed);
          } catch (error) {
            response.write = originalWrite;
            throw error;
          }
        }) as typeof response.end;
        return next();
      });
    },
  };
}

export default defineConfig(({ command }) => {
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
      selectedSourcePlugin({ qualifyDependencyClosure: command === 'build' }),
      createSimulatorCssProfileVitePlugin({
        compilerRoot: simulatorRoot,
        foundationEntry: path.join(simulatorRoot, 'src/styles.css'),
        apps: selectedCssProfiles(),
      }),
      react(),
      tailwindcss(),
      controlledDevWithoutViteClient(),
    ],
    resolve: {
      dedupe: resolver.packages.map((row) => row.name),
    },
    // The governed resolver verifies every admitted target before startup.
    // Dev then lets Vite prebundle CommonJS targets so they expose the same
    // ESM surface that Rollup provides in Build.
    optimizeDeps: {
      include: [...resolver.devInteropImports],
    },
    server: {
      host: '127.0.0.1',
      strictPort: false,
      hmr: false,
    },
    // Selected sources are immutable standalone trees. Their repository-local
    // tsconfig inheritance is neither materialized nor allowed to influence
    // the final Simulator transform.
    esbuild: {
      tsconfigRaw: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          useDefineForClassFields: true,
          verbatimModuleSyntax: true,
        },
      }),
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
