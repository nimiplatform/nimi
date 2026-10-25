import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const AUTH_ENTRIES = [
  'web-account-page',
  'account-management-page',
  'account-recovery-page',
  'provider-link-callback-page',
] as const;
const RUNTIME_SOURCE = /\/sdks\/typescript\/(?:dist\/)?(?:runtime\/|core-generated\/runtime[^/]*|core\/app\/|core\/ai(?:\/|-runner\/))/u;
const RUNTIME_MARKERS = ['RuntimeAiService', 'RuntimeAgentService', 'RuntimeAppService', 'RuntimeLocalService'];

export function localJavaScriptImports(source: string, includeDynamic: boolean): string[] {
  const imports = new Set<string>();
  const ast = ts.createSourceFile('chunk.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const add = (value: ts.Node | undefined) => {
    if (value && ts.isStringLiteralLike(value) && /^\.\.?\//u.test(value.text)) imports.add(value.text);
  };
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) add(statement.moduleSpecifier);
  }
  if (includeDynamic) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...imports];
}

type SourceMap = { sources: string[] };
type Chunk = { code: string; sources: string[] };
export type ClosureMeasurement = {
  files: string[];
  bytes: number;
  runtimeSources: string[];
  runtimeMarkers: string[];
  realmSources: string[];
};
export type AuthDependencyReport = {
  initial: ClosureMeasurement;
  routes: Array<{ entry: string; static: ClosureMeasurement; withAuthDynamicImports: ClosureMeasurement }>;
};

export async function inspectAuthDependencyClosure(dist: string): Promise<AuthDependencyReport> {
  const root = path.resolve(dist);
  const chunks = new Map<string, Chunk>();
  const load = async (file: string): Promise<Chunk> => {
    const cached = chunks.get(file);
    if (cached) return cached;
    const code = await readFile(file, 'utf8');
    let sources: string[] = [];
    try {
      sources = (JSON.parse(await readFile(`${file}.map`, 'utf8')) as SourceMap).sources;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const chunk = { code, sources: sources.map(source => source.replaceAll('\\', '/')) };
    chunks.set(file, chunk);
    return chunk;
  };
  const closure = async (entry: string, includeDynamic: boolean): Promise<Set<string>> => {
    const files = new Set<string>();
    const visit = async (file: string): Promise<void> => {
      const relative = path.relative(root, file);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Chunk escapes build: ${file}`);
      if (files.has(file)) return;
      files.add(file);
      const chunk = await load(file);
      for (const imported of localJavaScriptImports(chunk.code, includeDynamic)) {
        await visit(path.resolve(path.dirname(file), imported));
      }
    };
    await visit(entry);
    return files;
  };
  const measure = async (files: Set<string>): Promise<ClosureMeasurement> => {
    let bytes = 0;
    const runtimeSources = new Set<string>();
    const runtimeMarkers = new Set<string>();
    const realmSources = new Set<string>();
    for (const file of files) {
      const chunk = await load(file);
      bytes += Buffer.byteLength(chunk.code);
      for (const source of chunk.sources) {
        if (RUNTIME_SOURCE.test(source)) runtimeSources.add(source);
        if (/\/sdks\/typescript\/(?:dist\/)?realm\//u.test(source)) realmSources.add(source);
      }
      for (const marker of RUNTIME_MARKERS) if (chunk.code.includes(marker)) runtimeMarkers.add(marker);
    }
    return {
      files: [...files].map(file => path.relative(root, file).replaceAll('\\', '/')).sort(), bytes,
      runtimeSources: [...runtimeSources].sort(), runtimeMarkers: [...runtimeMarkers].sort(), realmSources: [...realmSources].sort(),
    };
  };

  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const script = /<script\b[^>]*type="module"[^>]*src="([^"]+\.js)"/u.exec(html)?.[1];
  assert.ok(script, 'Production index has no module entry');
  const initial = await closure(path.resolve(root, script.replace(/^\//u, '')), false);
  const assets = path.join(root, 'assets');
  const files = await readdir(assets);
  const routes: AuthDependencyReport['routes'] = [];
  for (const entry of AUTH_ENTRIES) {
    const candidates = files.filter(file => file.startsWith(`${entry}-`) && file.endsWith('.js'));
    assert.equal(candidates.length, 1, `Expected one production ${entry} entry`);
    const file = path.join(assets, candidates[0]!);
    const map = await load(file);
    assert.ok(map.sources.some(source => source.endsWith(`/auth/${entry}.tsx`)), `Missing ${entry} source map`);
    const direct = await closure(file, false);
    const interactive = await closure(file, true);
    routes.push({
      entry,
      static: await measure(new Set([...initial, ...direct])),
      // Follow dynamic imports in the Auth branch, not unrelated lazy routes
      // reachable from the shared HTML router. This includes its visual loader.
      withAuthDynamicImports: await measure(new Set([...initial, ...interactive])),
    });
  }
  return { initial: await measure(initial), routes };
}

export function assertAuthDependencyClosure(report: AuthDependencyReport): void {
  for (const route of report.routes) {
    for (const measurement of [route.static, route.withAuthDynamicImports]) {
      assert.deepEqual(measurement.runtimeSources, [], `${route.entry} retains Runtime/App/AI modules`);
      assert.deepEqual(measurement.runtimeMarkers, [], `${route.entry} retains Runtime service code`);
      for (const module of ['index', 'fetch-transport']) {
        assert.ok(measurement.realmSources.some(source => source.endsWith(`/realm/${module}.js`)), `${route.entry} lost Realm ${module}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--report-only'), 'Only --report-only is supported');
  const report = await inspectAuthDependencyClosure(fileURLToPath(new URL('../dist', import.meta.url)));
  const summarize = (value: ClosureMeasurement) => ({
    files: value.files.length, bytes: value.bytes, runtimeSourceCount: value.runtimeSources.length,
    runtimeMarkers: value.runtimeMarkers, realmSources: value.realmSources,
  });
  console.log(JSON.stringify({
    initial: summarize(report.initial),
    routes: report.routes.map(route => ({
      entry: route.entry, static: summarize(route.static),
      withAuthDynamicImports: summarize(route.withAuthDynamicImports),
    })),
  }, null, 2));
  if (args[0] !== '--report-only') assertAuthDependencyClosure(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}
