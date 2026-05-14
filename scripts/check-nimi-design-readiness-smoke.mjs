#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const topicId = '2026-05-14-design-system-kit-hardcut-audit-and-alignment';

function resolveTopicDir() {
  const lifecycleRoots = ['ongoing', 'closed', 'pending', 'proposal'];
  for (const lifecycleRoot of lifecycleRoots) {
    const candidate = path.join(repoRoot, '.nimi', 'topics', lifecycleRoot, topicId);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(repoRoot, '.nimi', 'topics', 'ongoing', topicId);
}

const topicDir = resolveTopicDir();
const evidenceDir = path.join(topicDir, 'evidence', 'wave-6-readiness');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function readYaml(rel) {
  return YAML.parse(read(rel));
}

function write(relOrAbs, content) {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(repoRoot, relOrAbs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function resolveFromPackage(packageJsonRel, specifier) {
  const require = createRequire(path.join(repoRoot, packageJsonRel));
  return require.resolve(specifier);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function countManifestRows(rel) {
  const doc = readYaml(rel);
  return Array.isArray(doc?.modules) ? doc.modules.length : 0;
}

function verifyAppEntry(app, rel) {
  const doc = readYaml(rel);
  const entry = doc?.app_entry && typeof doc.app_entry === 'object' ? doc.app_entry : {};
  const styleRel = String(entry.style || '').trim();
  const bootstrapRel = String(entry.bootstrap || '').trim();
  const themeProviderRel = String(entry.theme_provider || '').trim();
  const modules = Array.isArray(doc?.modules) ? doc.modules : [];
  const style = styleRel ? read(styleRel) : '';
  const requiredImports = [
    '@nimiplatform/nimi-kit/ui/styles.css',
    '@nimiplatform/nimi-kit/ui/themes/light.css',
    '@nimiplatform/nimi-kit/ui/themes/dark.css',
    '@nimiplatform/nimi-kit/ui/themes/nimi-accent.css',
  ];
  const missingImports = requiredImports.filter((requiredImport) => !style.includes(requiredImport));
  const missingFiles = [styleRel, bootstrapRel, themeProviderRel]
    .filter(Boolean)
    .filter((fileRel) => !exists(fileRel));
  const missingModuleFiles = modules
    .map((moduleRow) => String(moduleRow?.module || '').trim())
    .filter(Boolean)
    .filter((moduleRel) => !exists(moduleRel));

  return {
    app,
    manifest: rel,
    style: styleRel,
    bootstrap: bootstrapRel,
    themeProvider: themeProviderRel,
    moduleCount: modules.length,
    missingImports,
    missingFiles,
    missingModuleFiles,
    ok: missingImports.length === 0 && missingFiles.length === 0 && missingModuleFiles.length === 0 && modules.length > 0,
  };
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

function serveStatic(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const requestPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
      const filePath = path.resolve(rootDir, `.${requestPath}`);
      if (!filePath.startsWith(path.resolve(rootDir))) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end('not found');
          return;
        }
        response.writeHead(200, { 'content-type': contentTypeFor(filePath) });
        response.end(data);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('static server did not bind to a TCP port'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function runChrome(chrome, args) {
  return new Promise((resolve) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 60000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function captureChrome(chrome, htmlPath, pngPath) {
  const staticRoot = path.dirname(htmlPath);
  const { server, port } = await serveStatic(staticRoot);
  try {
    const result = await runChrome(chrome, [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--run-all-compositor-stages-before-draw',
      '--timeout=5000',
      '--virtual-time-budget=5000',
      '--window-size=960,640',
      `--screenshot=${pngPath}`,
      `http://127.0.0.1:${port}/${path.basename(htmlPath)}`,
    ]);
    return result;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function viteConfigText(appRoot, extraAliases = []) {
  const aliases = [
    ['react/jsx-runtime', path.join(appRoot, 'node_modules/react/jsx-runtime.js')],
    ['react/jsx-dev-runtime', path.join(appRoot, 'node_modules/react/jsx-dev-runtime.js')],
    ['react-dom/client', path.join(appRoot, 'node_modules/react-dom/client.js')],
    ['react-dom', path.join(appRoot, 'node_modules/react-dom/index.js')],
    ['react', path.join(appRoot, 'node_modules/react/index.js')],
    ['@nimiplatform/nimi-kit/ui', path.join(repoRoot, 'kit/ui/src')],
    ['@nimiplatform/nimi-kit/auth', path.join(repoRoot, 'kit/auth/src')],
    ['@nimiplatform/nimi-kit/core', path.join(repoRoot, 'kit/core/src')],
    ...extraAliases,
  ];
  const aliasSource = aliases
    .map(([find, replacement]) => `{ find: ${JSON.stringify(find)}, replacement: ${JSON.stringify(replacement)} }`)
    .join(',\n        ');
  return `import { createRequire } from 'node:module';
import path from 'node:path';

const appRoot = ${JSON.stringify(appRoot)};
const require = createRequire(path.join(appRoot, 'package.json'));
const { defineConfig } = await import(require.resolve('vite'));
const react = (await import(require.resolve('@vitejs/plugin-react'))).default;

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: false,
  resolve: {
    alias: [
        ${aliasSource}
    ],
  },
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
`;
}

function buildFocusedSurface(surface) {
  const harnessDir = path.join(evidenceDir, 'render-harness', surface.id);
  const srcDir = path.join(harnessDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  write(path.join(harnessDir, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n');
  write(path.join(srcDir, 'main.tsx'), surface.mainSource);
  write(path.join(harnessDir, 'vite.config.mjs'), viteConfigText(surface.appRoot, surface.aliases ?? []));
  const result = spawnSync('pnpm', [
    '--dir',
    surface.appRoot,
    'exec',
    'vite',
    'build',
    '--config',
    path.join(harnessDir, 'vite.config.mjs'),
    '--logLevel',
    'error',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 20,
  });
  write(path.join(evidenceDir, `${surface.id}.vite.stdout.txt`), result.stdout || '');
  write(path.join(evidenceDir, `${surface.id}.vite.stderr.txt`), result.stderr || '');
  return {
    status: result.status,
    signal: result.signal,
    ok: result.status === 0,
    htmlPath: path.join(harnessDir, 'dist', 'index.html'),
    harnessDir,
    stdout: path.relative(repoRoot, path.join(evidenceDir, `${surface.id}.vite.stdout.txt`)),
    stderr: path.relative(repoRoot, path.join(evidenceDir, `${surface.id}.vite.stderr.txt`)),
  };
}

function runCommand(id, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    maxBuffer: 1024 * 1024 * 80,
  });
  write(path.join(evidenceDir, `${id}.stdout.txt`), result.stdout || '');
  write(path.join(evidenceDir, `${id}.stderr.txt`), result.stderr || '');
  return {
    id,
    command: [command, ...args].join(' '),
    status: result.status,
    signal: result.signal,
    ok: result.status === 0,
    stdout: path.relative(repoRoot, path.join(evidenceDir, `${id}.stdout.txt`)),
    stderr: path.relative(repoRoot, path.join(evidenceDir, `${id}.stderr.txt`)),
  };
}

function assertOk(condition, message, failures) {
  if (!condition) failures.push(message);
}

fs.rmSync(evidenceDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const failures = [];
const chrome = findChrome();
assertOk(chrome !== null, 'Chrome/Chromium executable is required for screenshot evidence', failures);

const platformTables = {
  adoption: readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml'),
  compositions: readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-compositions.yaml'),
  allowlists: readYaml('.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml'),
};
assertOk((platformTables.adoption?.modules ?? []).length === 0, 'platform adoption table must remain empty', failures);
assertOk((platformTables.compositions?.components ?? []).length === 0, 'platform compositions table must remain empty', failures);
assertOk((platformTables.allowlists?.items ?? []).length === 0, 'platform allowlists table must remain empty', failures);

const appChecks = [
  verifyAppEntry('desktop', '.nimi/spec/desktop/kernel/tables/nimi-kit-adoption.yaml'),
  verifyAppEntry('parentos', 'apps/parentos/spec/kernel/tables/nimi-kit-adoption.yaml'),
  verifyAppEntry('avatar', '.nimi/spec/avatar/kernel/tables/nimi-kit-adoption.yaml'),
];
for (const check of appChecks) {
  assertOk(check.ok, `${check.app} app-local kit adoption entry is incomplete`, failures);
}

const surfaces = [
  {
    id: 'desktop-shell',
    app: 'desktop',
    appRoot: path.join(repoRoot, 'apps/desktop'),
    scheme: 'dark',
    componentModules: [
      'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-primitives.tsx',
      'apps/desktop/src/shell/renderer/components/surface.tsx',
    ],
    aliases: [
      ['@renderer', path.join(repoRoot, 'apps/desktop/src/shell/renderer')],
      ['@runtime', path.join(repoRoot, 'apps/desktop/src/runtime')],
      ['react-i18next', path.join(repoRoot, 'apps/desktop/node_modules/react-i18next/dist/es/index.js')],
    ],
    mainSource: `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ${JSON.stringify(path.join(repoRoot, 'apps/desktop/src/shell/renderer/styles.css'))};
import { Card, Button, RuntimeSelect, StatusBadge, DaemonStatusBadge } from ${JSON.stringify(path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-primitives.tsx'))};

document.documentElement.dataset.nimiScheme = 'dark';
document.documentElement.dataset.nimiAccent = 'nimi-accent';

function App() {
  const [runtime, setRuntime] = useState('local');
  return (
    <main style={{ width: 960, height: 640, padding: 40, boxSizing: 'border-box', background: 'var(--nimi-app-background)', color: 'var(--nimi-text-primary)' }}>
      <Card className="p-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">Desktop focused component surface</p>
        <h1 className="text-2xl font-bold text-[var(--nimi-text-primary)]">Runtime kit primitives</h1>
        <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">Rendered from Desktop runtime-config primitives and DesktopCardSurface.</p>
        <div className="mt-5 max-w-xs">
          <RuntimeSelect
            value={runtime}
            onChange={setRuntime}
            options={[{ value: 'local', label: 'Local runtime' }, { value: 'cloud', label: 'Cloud runtime' }]}
          />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusBadge status="healthy" />
          <DaemonStatusBadge running={true} />
          <Button>Commit changes</Button>
        </div>
      </Card>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
`,
  },
  {
    id: 'parentos-shell',
    app: 'parentos',
    appRoot: path.join(repoRoot, 'apps/parentos'),
    scheme: 'light',
    componentModules: [
      'apps/parentos/src/shell/renderer/features/timeline/timeline-card-primitives.tsx',
      'apps/parentos/src/shell/renderer/features/advisor/advisor-empty-state.tsx',
    ],
    aliases: [
      ['@renderer', path.join(repoRoot, 'apps/parentos/src/shell/renderer')],
      ['@engine', path.join(repoRoot, 'apps/parentos/src/shell/renderer/engine')],
    ],
    mainSource: `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ${JSON.stringify(path.join(repoRoot, 'apps/parentos/src/shell/renderer/styles.css'))};
import { Cd, Hdr } from ${JSON.stringify(path.join(repoRoot, 'apps/parentos/src/shell/renderer/features/timeline/timeline-card-primitives.tsx'))};
import { AdvisorEmptyState } from ${JSON.stringify(path.join(repoRoot, 'apps/parentos/src/shell/renderer/features/advisor/advisor-empty-state.tsx'))};

document.documentElement.dataset.nimiScheme = 'light';
document.documentElement.dataset.nimiAccent = 'nimi-accent';

function App() {
  const [section, setSection] = useState('growth');
  return (
    <main style={{ width: 960, height: 640, padding: 40, boxSizing: 'border-box', background: 'var(--nimi-app-background)', color: 'var(--nimi-text-primary)' }}>
      <Cd cls="grid max-w-3xl grid-cols-[1fr_280px] gap-6">
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">ParentOS focused component surface</p>
          <Hdr title="成长底稿" />
          <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">Rendered from ParentOS timeline card primitive and advisor empty-state module through the shared kit material surface.</p>
          <div className="mt-5 flex gap-2">
            {['growth', 'journal', 'reports'].map((item) => (
              <button
                key={item}
                className="rounded-full border border-[var(--nimi-border-subtle)] px-4 py-2 text-sm font-semibold text-[var(--nimi-text-primary)]"
                type="button"
                onClick={() => setSection(item)}
              >
                {section === item ? '当前' : '切换'}
              </button>
            ))}
          </div>
        </section>
        <AdvisorEmptyState childName="Nimi" runtimeAvailable={false} />
      </Cd>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
`,
  },
  {
    id: 'avatar-companion',
    app: 'avatar',
    appRoot: path.join(repoRoot, 'apps/avatar'),
    scheme: 'dark',
    componentModules: [
      'apps/avatar/src/shell/renderer/degraded-surface/degraded-surface.tsx',
      'apps/avatar/src/shell/renderer/app-shell/composition-events.ts',
    ],
    aliases: [
      ['@renderer', path.join(repoRoot, 'apps/avatar/src/shell/renderer')],
      ['@nimiplatform/nimi-kit/shell/renderer/bridge', path.join(repoRoot, 'kit/shell/renderer/src/bridge/index.ts')],
      ['react-i18next', resolveFromPackage('apps/avatar/package.json', 'react-i18next')],
      ['i18next', resolveFromPackage('apps/avatar/package.json', 'i18next')],
    ],
    mainSource: `import React from 'react';
import { createRoot } from 'react-dom/client';
import ${JSON.stringify(path.join(repoRoot, 'apps/avatar/src/shell/renderer/app.css'))};
import { DegradedSurface } from ${JSON.stringify(path.join(repoRoot, 'apps/avatar/src/shell/renderer/degraded-surface/degraded-surface.tsx'))};

document.documentElement.dataset.nimiScheme = 'dark';
document.documentElement.dataset.nimiAccent = 'nimi-accent';

const composition = {
  state: 'degraded_runtime_unavailable',
  variant: 'degraded',
  reason: 'Runtime unavailable in readiness smoke',
  reasonCode: 'READINESS_SMOKE',
  accountReasonCode: null,
  actionHint: null,
  stage: 'readiness',
};

function App() {
  return (
    <main style={{ width: 960, height: 640, position: 'relative', background: 'transparent' }}>
      <DegradedSurface composition={composition as any} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
`,
  },
];

const visualEvidence = [];
if (chrome) {
  for (const surface of surfaces) {
    const pngPath = path.join(evidenceDir, `${surface.id}.png`);
    const build = buildFocusedSurface(surface);
    assertOk(build.ok, `${surface.id} focused Vite component harness failed to build`, failures);
    const capture = build.ok ? await captureChrome(chrome, build.htmlPath, pngPath) : { status: null, signal: null, stdout: '', stderr: '' };
    write(path.join(evidenceDir, `${surface.id}.chrome.stdout.txt`), capture.stdout || '');
    write(path.join(evidenceDir, `${surface.id}.chrome.stderr.txt`), capture.stderr || '');
    const pngBytes = fs.existsSync(pngPath) ? fs.statSync(pngPath).size : 0;
    const item = {
      id: surface.id,
      app: surface.app,
      html: path.relative(repoRoot, build.htmlPath),
      screenshot: path.relative(repoRoot, pngPath),
      componentModules: surface.componentModules,
      viteStatus: build.status,
      viteSignal: build.signal,
      viteStdout: build.stdout,
      viteStderr: build.stderr,
      chromeStatus: capture.status,
      chromeSignal: capture.signal,
      screenshotBytes: pngBytes,
      ok: build.ok && capture.status === 0 && capture.signal === null && pngBytes > 12000,
    };
    visualEvidence.push(item);
    assertOk(item.ok, `${surface.id} screenshot capture failed or produced an empty image`, failures);
  }
}

const newAppBootstrapReportPath = path.join(evidenceDir, 'new-app-bootstrap-positive.json');
const newAppBootstrap = runCommand(
  'new-app-bootstrap-fixtures',
  process.execPath,
  [path.join(repoRoot, 'scripts', 'check-nimi-design-gate-negative-fixtures.mjs')],
  {
    env: {
      NIMI_DESIGN_GATE_FIXTURE_REPORT: newAppBootstrapReportPath,
    },
  },
);
assertOk(newAppBootstrap.ok, 'new app bootstrap fixture gate must pass', failures);

let newAppBootstrapReport = null;
if (fs.existsSync(newAppBootstrapReportPath)) {
  newAppBootstrapReport = JSON.parse(fs.readFileSync(newAppBootstrapReportPath, 'utf8'));
}
const positiveBootstrap = newAppBootstrapReport?.positiveBootstrap ?? null;
assertOk(newAppBootstrapReport?.ok === true, 'new app bootstrap fixture report must be ok', failures);
assertOk(positiveBootstrap?.platformDesignRows?.adoption === 0, 'new app bootstrap must preserve empty platform adoption table', failures);
assertOk(positiveBootstrap?.platformDesignRows?.compositions === 0, 'new app bootstrap must preserve empty platform compositions table', failures);
assertOk(positiveBootstrap?.platformDesignRows?.allowlists === 0, 'new app bootstrap must preserve empty platform allowlists table', failures);

const closeoutGateChecks = [
  newAppBootstrap,
  runCommand('check-nimi-ui-pattern', 'pnpm', ['check:nimi-ui-pattern']),
  runCommand('check-nimi-kit', 'pnpm', ['check:nimi-kit']),
  runCommand('check-nimi-ui-lib-drift', 'pnpm', ['check:nimi-ui-lib-drift']),
  runCommand('nimi-kit-build', 'pnpm', ['--filter', '@nimiplatform/nimi-kit', 'build']),
  runCommand('nimi-kit-test', 'pnpm', ['--filter', '@nimiplatform/nimi-kit', 'test']),
  runCommand('desktop-test', 'pnpm', ['--filter', '@nimiplatform/desktop', 'test']),
  runCommand('parentos-test', 'pnpm', ['--filter', '@nimiplatform/parentos', 'test']),
  runCommand('avatar-test', 'pnpm', ['--filter', '@nimiplatform/avatar', 'test']),
  runCommand('spec-governance-all', 'pnpm', ['exec', 'nimicoding', 'validate-spec-governance', '--profile', 'nimi', '--scope', 'all']),
  runCommand('platform-generated-docs', 'pnpm', ['exec', 'nimicoding', 'generate-spec-derived-docs', '--profile', 'nimi', '--scope', 'platform', '--check']),
  runCommand('topic-validate', 'pnpm', ['exec', 'nimicoding', 'topic', 'validate', topicId, '--json']),
  runCommand('topic-validate-graph', 'pnpm', ['exec', 'nimicoding', 'topic', 'validate', 'graph', topicId, '--json']),
  runCommand('git-diff-check', 'git', ['diff', '--check']),
];
for (const gate of closeoutGateChecks) {
  assertOk(gate.ok, `${gate.id} must pass`, failures);
}

const report = {
  ok: failures.length === 0,
  generatedAt: new Date().toISOString(),
  topicId,
  chrome,
  evidenceDir: path.relative(repoRoot, evidenceDir),
  authorityBoundary: {
    platformDesignTablesEmpty: true,
    concreteConsumptionAuthority: 'app-local nimi-kit manifests only',
  },
  appChecks,
  visualEvidence,
  newAppBootstrap,
  newAppBootstrapReport: path.relative(repoRoot, newAppBootstrapReportPath),
  newAppBootstrapPositive: positiveBootstrap,
  closeoutGateChecks,
  gateChecks: closeoutGateChecks,
  failures,
};

write(path.join(evidenceDir, 'readiness-report.json'), `${JSON.stringify(report, null, 2)}\n`);
write(path.join(evidenceDir, 'README.md'), `# Wave 6 Readiness Evidence

Generated by \`pnpm check:nimi-design-readiness-smoke\`.

- Desktop screenshot: \`${visualEvidence.find((item) => item.id === 'desktop-shell')?.screenshot ?? 'missing'}\`
- ParentOS screenshot: \`${visualEvidence.find((item) => item.id === 'parentos-shell')?.screenshot ?? 'missing'}\`
- Avatar screenshot: \`${visualEvidence.find((item) => item.id === 'avatar-companion')?.screenshot ?? 'missing'}\`
- Machine report: \`${path.relative(repoRoot, path.join(evidenceDir, 'readiness-report.json'))}\`
- New-app bootstrap positive report: \`${path.relative(repoRoot, newAppBootstrapReportPath)}\`
- Closeout gate count: ${closeoutGateChecks.length}
`);

if (failures.length > 0) {
  process.stderr.write(`nimi design readiness smoke failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`nimi design readiness smoke passed: ${path.relative(repoRoot, evidenceDir)}\n`);
