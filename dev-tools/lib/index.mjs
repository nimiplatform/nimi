import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';

const SDK_VERSION = '^0.2.0';
const DEV_TOOLS_VERSION = '^0.2.0';
const REACT_VERSION = '^19.1.0';
const TYPESCRIPT_VERSION = '^5.9.3';
const TSX_VERSION = '^4.21.0';
const NODE_TYPES_VERSION = '^24.10.1';
const REACT_TYPES_VERSION = '^19.2.14';
const AI_SDK_VERSION = '^6.0.85';
const require = createRequire(import.meta.url);
const MOD_THEME_CSS = `
@theme {
  --color-mint-50: #e6f7f2;
  --color-mint-100: #ccefe5;
  --color-mint-200: #99dfc8;
  --color-mint-300: #66cfab;
  --color-mint-400: #33bf8e;
  --color-mint-500: #4ECCA3;
  --color-mint-600: #3DBB96;
  --color-mint-700: #2AA880;
  --color-mint-800: #1F8C6B;
  --color-mint-900: #166B52;
  --color-brand-50: #ecfeff;
  --color-brand-100: #cefafe;
  --color-brand-200: #a2f4fd;
  --color-brand-300: #67e1f5;
  --color-brand-400: #22cce7;
  --color-brand-500: #00b8db;
  --color-brand-600: #0092b8;
  --color-brand-700: #007595;
  --color-brand-800: #065f7c;
  --color-brand-900: #0a4e68;
  --color-accent-50: #dbeafe;
  --color-accent-100: #bedbff;
  --color-accent-500: #155dfc;
  --color-accent-600: #1447e6;
  --color-accent-700: #1240cc;
}
`.trim();

const MOD_COMPATIBILITY_CSS = `
@layer base {
  [data-nimi-mod-root],
  [data-nimi-mod-portal] {
    --font-ui: "Inter", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif;
    --font-display: "Noto Sans SC", "Source Han Sans SC", "Inter", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif;
    --font-serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif;
    --font-sans: var(--font-ui);
    --nimi-mod-mint-500: var(--color-mint-500);
    --nimi-mod-brand-500: var(--color-brand-500);
    --nimi-mod-accent-500: var(--color-accent-500);
    color: var(--color-gray-900);
    font-family: var(--font-ui);
    line-height: 1.5;
    color-scheme: light;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  [data-nimi-mod-root],
  [data-nimi-mod-root] *,
  [data-nimi-mod-root] *::before,
  [data-nimi-mod-root] *::after,
  [data-nimi-mod-portal],
  [data-nimi-mod-portal] *,
  [data-nimi-mod-portal] *::before,
  [data-nimi-mod-portal] *::after {
    box-sizing: border-box;
  }

  [data-nimi-mod-root] button,
  [data-nimi-mod-root] input,
  [data-nimi-mod-root] select,
  [data-nimi-mod-root] textarea,
  [data-nimi-mod-portal] button,
  [data-nimi-mod-portal] input,
  [data-nimi-mod-portal] select,
  [data-nimi-mod-portal] textarea {
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
  }

  [data-nimi-mod-root] button,
  [data-nimi-mod-portal] button {
    cursor: pointer;
  }

  [data-nimi-mod-root] :where(button, input, select, textarea):focus-visible,
  [data-nimi-mod-portal] :where(button, input, select, textarea):focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-brand-500) 58%, white);
    outline-offset: 2px;
  }
}

@layer utilities {
  .brand-gradient {
    background: linear-gradient(145deg, var(--color-brand-500) 0%, var(--color-accent-500) 100%);
  }

  @keyframes nimi-mod-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes nimi-mod-zoom-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes nimi-mod-slide-in-bottom {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes nimi-mod-slide-in-top {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes nimi-mod-slide-in-left {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes nimi-mod-slide-in-right {
    from {
      opacity: 0;
      transform: translateX(8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .animate-in {
    animation-duration: 180ms;
    animation-fill-mode: both;
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .fade-in,
  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .fade-in-0 {
    animation-name: nimi-mod-fade-in;
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .zoom-in,
  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .zoom-in-95 {
    animation-name: nimi-mod-zoom-in;
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .slide-in-from-bottom-2 {
    animation-name: nimi-mod-slide-in-bottom;
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .slide-in-from-top-2 {
    animation-name: nimi-mod-slide-in-top;
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .slide-in-from-left-2 {
    animation-name: nimi-mod-slide-in-left;
  }

  :where([data-nimi-mod-root], [data-nimi-mod-portal]) .slide-in-from-right-2 {
    animation-name: nimi-mod-slide-in-right;
  }
}
`.trim();

function getTailwindCliEntrypoint() {
  const packageJsonPath = require.resolve('@tailwindcss/cli/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const binRelativePath = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.tailwindcss;
  if (!binRelativePath) {
    throw new Error('Unable to resolve @tailwindcss/cli binary path.');
  }
  return path.join(path.dirname(packageJsonPath), binRelativePath);
}

function getTailwindStylesheetPath() {
  return require.resolve('tailwindcss/index.css');
}

function toPosixPath(value) {
  return String(value || '').split(path.sep).join('/');
}

function escapeCssString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function createTailwindInput(modDir) {
  const normalizedModDir = toPosixPath(path.resolve(modDir));
  return [
    `@import "${escapeCssString(toPosixPath(getTailwindStylesheetPath()))}";`,
    MOD_THEME_CSS,
    MOD_COMPATIBILITY_CSS,
    `@source "${escapeCssString(`${normalizedModDir}/index.ts`)}";`,
    `@source "${escapeCssString(`${normalizedModDir}/src`)}";`,
    '',
  ].join('\n');
}

function normalizeSlug(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/g, '')
    .replace(/-+$/g, '');
  return normalized || fallback;
}

function ensureDirEmptyOrMissing(targetDir) {
  if (!existsSync(targetDir)) {
    return;
  }
  const probe = spawnSync('find', [targetDir, '-mindepth', '1', '-maxdepth', '1'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const output = String(probe.stdout || '').trim();
  if (output) {
    throw new Error(`Refusing to scaffold into non-empty directory: ${targetDir}`);
  }
}

function writeJSONFile(targetPath, value) {
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createFileTree(baseDir, files) {
  for (const file of files) {
    const targetPath = path.join(baseDir, file.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content, 'utf8');
  }
}

export function findManifestFile(modDir) {
  const candidates = ['mod.manifest.yaml', 'mod.manifest.yml', 'mod.manifest.json'];
  for (const filename of candidates) {
    const candidate = path.join(modDir, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function parseManifest(modDir) {
  const manifestPath = findManifestFile(modDir);
  if (!manifestPath) {
    throw new Error(`Missing mod manifest in ${modDir}`);
  }
  const raw = readFileSync(manifestPath, 'utf8');
  const ext = path.extname(manifestPath).toLowerCase();
  const value = ext === '.json' ? JSON.parse(raw) : parseYaml(raw);
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid manifest: ${manifestPath}`);
  }
  const id = String(value.id || '').trim();
  const entry = String(value.entry || '').trim();
  const styles = Array.isArray(value.styles)
    ? value.styles.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!id) {
    throw new Error(`Manifest missing "id": ${manifestPath}`);
  }
  if (!entry) {
    throw new Error(`Manifest missing "entry": ${manifestPath}`);
  }
  return {
    id,
    entry,
    styles,
    manifestPath,
    raw: value,
  };
}

export function resolveModDir(cwd, explicitModDir) {
  const normalizedExplicit = String(explicitModDir || '').trim();
  if (normalizedExplicit) {
    return path.resolve(cwd, normalizedExplicit);
  }
  if (findManifestFile(cwd)) {
    return cwd;
  }
  throw new Error('Current working directory is not a mod root. Run from a mod directory or pass --mod-dir <path>.');
}

function getExternalList() {
  return [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@nimiplatform/sdk',
    '@nimiplatform/sdk/*',
    '@tanstack/react-query',
    'i18next',
    'react-i18next',
    'zod',
    'zustand',
  ];
}

function createPreferTypeScriptSourcesPlugin(modDir) {
  const normalizedModDir = path.resolve(modDir);
  return {
    name: 'prefer-typescript-sources',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        if (!args.importer || !args.path.endsWith('.js')) {
          return null;
        }
        const importerPath = path.resolve(args.importer);
        if (
          importerPath !== normalizedModDir
          && !importerPath.startsWith(`${normalizedModDir}${path.sep}`)
        ) {
          return null;
        }
        const withoutJsExt = args.path.slice(0, -3);
        for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
          const candidateAbsPath = path.resolve(path.dirname(importerPath), `${withoutJsExt}${ext}`);
          if (existsSync(candidateAbsPath)) {
            return { path: candidateAbsPath };
          }
        }
        return null;
      });
    },
  };
}

export function buildConfig(modDir) {
  const manifest = parseManifest(modDir);
  const entryPoint = path.join(modDir, 'index.ts');
  if (!existsSync(entryPoint)) {
    throw new Error(`Missing entry file: ${entryPoint}`);
  }
  const outFile = path.resolve(modDir, manifest.entry);
  const outDir = path.dirname(outFile);
  const distRoot = path.join(modDir, 'dist');
  return {
    modDir,
    manifest,
    entryPoint,
    outDir,
    distRoot,
    external: getExternalList(),
    plugins: [createPreferTypeScriptSourcesPlugin(modDir)],
  };
}

function generateStyleArtifacts(config) {
  if (!Array.isArray(config.manifest.styles) || config.manifest.styles.length === 0) {
    return;
  }

  const styleOutputPaths = config.manifest.styles.map((stylePath) => path.resolve(config.modDir, stylePath));
  for (const outputPath of styleOutputPaths) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-mod-tailwind-'));
  const inputPath = path.join(tempDir, 'input.css');
  writeFileSync(inputPath, createTailwindInput(config.modDir), 'utf8');

  const primaryOutputPath = styleOutputPaths[0];
  const build = spawnSync(process.execPath, [
    getTailwindCliEntrypoint(),
    '--input',
    inputPath,
    '--output',
    primaryOutputPath,
    '--minify',
  ], {
    cwd: config.modDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  rmSync(tempDir, { recursive: true, force: true });

  if (build.status !== 0) {
    const stderr = String(build.stderr || '').trim();
    const stdout = String(build.stdout || '').trim();
    throw new Error(
      `tailwindcss build failed for ${config.manifest.id}: ${stderr || stdout || 'unknown error'}`,
    );
  }

  const primaryCss = readFileSync(primaryOutputPath, 'utf8');
  for (const outputPath of styleOutputPaths.slice(1)) {
    writeFileSync(outputPath, primaryCss, 'utf8');
  }
}

function createGenerateStylesPlugin(config) {
  return {
    name: 'generate-mod-styles',
    setup(build) {
      build.onEnd((result) => {
        if (Array.isArray(result.errors) && result.errors.length > 0) {
          return;
        }
        generateStyleArtifacts(config);
      });
    },
  };
}

export async function buildMod(modDir, watch = false) {
  const config = buildConfig(modDir);
  rmSync(config.distRoot, { recursive: true, force: true });
  const plugins = [...config.plugins, createGenerateStylesPlugin(config)];
  const context = await esbuild.context({
    entryPoints: [config.entryPoint],
    bundle: true,
    format: 'esm',
    outdir: config.outDir,
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    external: config.external,
    plugins,
    splitting: false,
    sourcemap: true,
    logLevel: 'info',
  });
  if (!watch) {
    await context.rebuild();
    await context.dispose();
    return;
  }
  await context.watch();
  process.stdout.write(
    [
      `[dev-tools] watching ${config.manifest.id}`,
      `[dev-tools] Desktop side: open Settings > Mod Developer, enable Developer Mode, add source directory: ${modDir}`,
      '[dev-tools] stop with Ctrl+C',
      '',
    ].join('\n'),
  );
  process.stdin.resume();
}

export function doctorMod(modDir) {
  const manifest = parseManifest(modDir);
  const indexTs = path.join(modDir, 'index.ts');
  if (!existsSync(indexTs)) {
    throw new Error(`Missing mod entry source: ${indexTs}`);
  }
  if (!/^\.?\/?dist\//.test(manifest.entry)) {
    throw new Error(`Manifest entry must target a prebuilt dist path. Received: ${manifest.entry}`);
  }
  for (const style of manifest.styles) {
    if (!/^\.?\/?dist\//.test(style)) {
      throw new Error(`Manifest styles[] must point at prebuilt dist assets. Received: ${style}`);
    }
  }
  process.stdout.write(
    [
      `[dev-tools] manifest ok: ${manifest.manifestPath}`,
      `[dev-tools] mod id: ${manifest.id}`,
      `[dev-tools] output entry: ${manifest.entry}`,
      manifest.styles.length > 0 ? `[dev-tools] styles: ${manifest.styles.join(', ')}` : '[dev-tools] styles: none',
      '',
    ].join('\n'),
  );
}

export function packMod(modDir) {
  const manifest = parseManifest(modDir);
  const outputDir = path.join(modDir, 'dist', 'packages');
  const outputFile = path.join(outputDir, `${manifest.id.replace(/[^\w.-]+/g, '-')}.zip`);
  const stagingDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-mod-pack-'));
  const distDir = path.join(modDir, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`Build output missing. Run build first: ${distDir}`);
  }
  cpSync(path.join(modDir, path.basename(manifest.manifestPath)), path.join(stagingDir, path.basename(manifest.manifestPath)));
  cpSync(distDir, path.join(stagingDir, 'dist'), { recursive: true });
  rmSync(path.join(stagingDir, 'dist', 'packages'), { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const command = spawnSync('zip', ['-r', outputFile, '.'], {
    cwd: stagingDir,
    stdio: 'inherit',
  });
  rmSync(stagingDir, { recursive: true, force: true });
  if (command.status !== 0) {
    throw new Error(`zip command failed for ${modDir}`);
  }
  process.stdout.write(`[dev-tools] package written: ${outputFile}\n`);
}

export function createMod(cwd, options = {}) {
  const name = String(options.name || '').trim() || 'My Mod';
  const slug = normalizeSlug(name, 'my-mod');
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || slug);
  const modId = String(options.modId || '').trim() || `world.nimi.${slug}`;
  ensureDirEmptyOrMissing(targetDir);
  mkdirSync(targetDir, { recursive: true });
  const packageJSON = {
    name: slug,
    private: true,
    type: 'module',
    version: '0.1.0',
    scripts: {
      build: 'nimi-mod build',
      dev: 'nimi-mod dev',
      doctor: 'nimi-mod doctor',
      pack: 'nimi-mod pack',
    },
    dependencies: {
      '@nimiplatform/sdk': SDK_VERSION,
      react: REACT_VERSION,
    },
    devDependencies: {
      '@nimiplatform/dev-tools': DEV_TOOLS_VERSION,
      '@types/node': NODE_TYPES_VERSION,
      '@types/react': REACT_TYPES_VERSION,
      typescript: TYPESCRIPT_VERSION,
    },
  };
  writeJSONFile(path.join(targetDir, 'package.json'), packageJSON);
  writeJSONFile(path.join(targetDir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      resolveJsonModule: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      types: ['node', 'react'],
    },
    include: ['index.ts', 'src/**/*.ts', 'src/**/*.tsx'],
    exclude: ['dist/**', 'node_modules/**'],
  });
  createFileTree(targetDir, [
    {
      path: 'mod.manifest.yaml',
      content: [
        `id: ${modId}`,
        `name: ${name}`,
        'version: 0.1.0',
        'description: Third-party runtime mod scaffold generated by nimi-mod create.',
        `entry: ./dist/mods/${slug}/index.js`,
        'styles:',
        `  - ./dist/mods/${slug}/index.css`,
        'capabilities:',
        '  - ui',
        '',
      ].join('\n'),
    },
    {
      path: 'index.ts',
      content: "export { createRuntimeMod } from './src/index.js';\n",
    },
    {
      path: 'src/index.tsx',
      content: [
        "import React from 'react';",
        "import { createHookClient } from '@nimiplatform/sdk/mod/hook';",
        "import { createModRuntimeClient } from '@nimiplatform/sdk/mod/runtime';",
        "import type { RuntimeModRegistration } from '@nimiplatform/sdk/mod/types';",
        '',
        `const MOD_ID = '${modId}';`,
        "const NAV_SLOT = 'ui-extension.app.sidebar.mods';",
        "const ROUTE_SLOT = 'ui-extension.app.content.routes';",
        `const TAB_ID = 'mod:${modId}';`,
        '',
        'function ScaffoldedModPage() {',
        "  return React.createElement('div', { className: 'm-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm' }, [",
        "    React.createElement('h2', { key: 'title', className: 'text-lg font-semibold text-gray-900' }, " + JSON.stringify(name) + '),',
        "    React.createElement('p', { key: 'body', className: 'mt-2' }, 'This page is loaded from a mod scaffold generated by nimi-mod create.'),",
        '  ]);',
        '}',
        '',
        'export function createRuntimeMod(): RuntimeModRegistration {',
        '  return {',
        '    modId: MOD_ID,',
        "    capabilities: ['ui'],",
        '    setup: async ({ sdkRuntimeContext }) => {',
        '      const hookClient = createHookClient(MOD_ID, sdkRuntimeContext);',
        '      const runtimeClient = createModRuntimeClient(MOD_ID, sdkRuntimeContext);',
        '      await hookClient.ui.register({',
        '        slot: NAV_SLOT,',
        '        priority: 150,',
        '        extension: {',
        "          type: 'nav-item',",
        '          tabId: TAB_ID,',
        `          label: ${JSON.stringify(name)},`,
        "          icon: 'puzzle',",
        "          strategy: 'append',",
        '        },',
        '      });',
        '      await hookClient.ui.register({',
        '        slot: ROUTE_SLOT,',
        '        priority: 150,',
        '        extension: {',
        "          type: 'tab-page',",
        '          tabId: TAB_ID,',
        "          strategy: 'append',",
        '          component: ScaffoldedModPage,',
        '        },',
        '      });',
        '      void runtimeClient;',
        '    },',
        '  };',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'README.md',
      content: [
        `# ${name}`,
        '',
        'Created with `nimi-mod create`.',
        '',
        '## Development',
        '',
        '```bash',
        'pnpm install',
        'pnpm dev',
        '```',
        '',
        'Then in Desktop open `Settings > Mod Developer`, enable `Developer Mode`, and add this directory as a `dev` source.',
        '',
      ].join('\n'),
    },
  ]);
  process.stdout.write(`[nimi-mod] created scaffold at ${targetDir} (mod_id=${modId})\n`);
}

function buildBasicAppTemplate() {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-nimi-app',
        private: true,
        type: 'module',
        scripts: {
          start: 'tsx index.ts',
        },
        dependencies: {
          '@nimiplatform/sdk': SDK_VERSION,
        },
        devDependencies: {
          tsx: TSX_VERSION,
          typescript: TYPESCRIPT_VERSION,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'index.ts',
      content: [
        "import { Runtime } from '@nimiplatform/sdk';",
        '',
        'const runtime = new Runtime();',
        '',
        'const result = await runtime.generate({',
        "  prompt: 'What is Nimi in one sentence?',",
        '});',
        '',
        'console.log(result.text);',
        '',
      ].join('\n'),
    },
    {
      path: '.env.example',
      content: [
        'NIMI_RUNTIME_ENDPOINT=127.0.0.1:46371',
        'NIMI_RUNTIME_CLOUD_OPENAI_API_KEY=',
        'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=',
        '',
      ].join('\n'),
    },
  ];
}

function buildVercelAIAppTemplate() {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-nimi-app',
        private: true,
        type: 'module',
        scripts: {
          start: 'tsx index.ts',
        },
        dependencies: {
          '@nimiplatform/sdk': SDK_VERSION,
          ai: AI_SDK_VERSION,
        },
        devDependencies: {
          tsx: TSX_VERSION,
          typescript: TYPESCRIPT_VERSION,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'index.ts',
      content: [
        "import { Runtime } from '@nimiplatform/sdk';",
        "import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';",
        "import { generateText } from 'ai';",
        '',
        'const runtime = new Runtime();',
        'const nimi = createNimiAiProvider({ runtime });',
        '',
        'const { text } = await generateText({',
        "  model: nimi.text('gemini/default'),",
        "  prompt: 'Hello from Vercel AI SDK + Nimi',",
        '});',
        '',
        'console.log(text);',
        '',
      ].join('\n'),
    },
    {
      path: '.env.example',
      content: [
        'NIMI_RUNTIME_ENDPOINT=127.0.0.1:46371',
        'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=',
        '',
      ].join('\n'),
    },
  ];
}

export function createApp(cwd, options = {}) {
  const template = String(options.template || '').trim() || 'basic';
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || 'my-nimi-app');
  ensureDirEmptyOrMissing(targetDir);
  mkdirSync(targetDir, { recursive: true });
  switch (template) {
    case 'basic':
      createFileTree(targetDir, buildBasicAppTemplate());
      break;
    case 'vercel-ai':
      createFileTree(targetDir, buildVercelAIAppTemplate());
      break;
    default:
      throw new Error(`Unsupported app template: ${template}`);
  }
  process.stdout.write(`[nimi-app] created ${template} app scaffold at ${targetDir}\n`);
}
