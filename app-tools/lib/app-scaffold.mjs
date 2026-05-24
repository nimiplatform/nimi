import path from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_APP_ID = 'my-nimi-app';
const DEFAULT_APP_TITLE = 'My Nimi App';
export const SCAFFOLD_VERSION = '2026-05-24.wave-4-remediation-b';
export const SCAFFOLD_LOCK_PATH = '.nimi/scaffold.lock.json';
export const SUPPORTED_APP_SCAFFOLD_PROFILES = ['standalone', 'workspace-app'];
const SCAFFOLD_LICENSE_YEAR = '2026';
const LOCKFILE_POLICY = 'author-install-generates-lockfile';
const MINIMAL_TAURI_ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slugify(input) {
  const normalized = String(input || DEFAULT_APP_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_APP_ID;
}

function normalizeExplicitAppId(input) {
  const normalized = String(input || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    throw new Error(`Invalid app id: ${input}`);
  }
  return normalized;
}

function resolveAppId(options) {
  if (String(options.appId || '').trim()) {
    return normalizeExplicitAppId(options.appId);
  }
  return slugify(options.name || DEFAULT_APP_ID);
}

function packageSafeName(input) {
  const normalized = String(input || DEFAULT_APP_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_APP_ID;
}

function validateNpmPackageSegment(segment) {
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(segment);
}

function normalizeExplicitPackageName(input) {
  const normalized = String(input || '').trim();
  if (!normalized || normalized.length > 214 || /\s/.test(normalized)) {
    throw new Error(`Invalid npm package name: ${input}`);
  }
  if (normalized.startsWith('@')) {
    const scopedMatch = normalized.match(/^@([^/]+)\/(.+)$/);
    if (!scopedMatch || !validateNpmPackageSegment(scopedMatch[1]) || !validateNpmPackageSegment(scopedMatch[2])) {
      throw new Error(`Invalid npm package name: ${input}`);
    }
    return normalized;
  }
  if (!validateNpmPackageSegment(normalized)) {
    throw new Error(`Invalid npm package name: ${input}`);
  }
  return normalized;
}

function resolvePackageName(options, appId) {
  if (String(options.packageName || '').trim()) {
    return normalizeExplicitPackageName(options.packageName);
  }
  return packageSafeName(appId);
}

function cargoSafeNameFromPackageName(input) {
  const normalized = String(input || DEFAULT_APP_ID)
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_APP_ID;
}

function tauriIdentifierFromAppId(appId) {
  const suffix = String(appId || DEFAULT_APP_ID)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
  return `ai.nimi.apps.${suffix || DEFAULT_APP_ID.replace(/-/g, '.')}`;
}

function buildAppIdentity(profile, appId, appTitle, packageName, author = '') {
  const resolvedPackageName = packageName || packageSafeName(appId);
  return {
    appId,
    appTitle,
    profile,
    packageName: resolvedPackageName,
    cargoPackageName: `${cargoSafeNameFromPackageName(resolvedPackageName)}-shell`,
    tauriIdentifier: tauriIdentifierFromAppId(appId),
    author: String(author || '').trim(),
  };
}

function resolveProfile(options) {
  const profile = String(options.profile || '').trim() || 'standalone';
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)) {
    throw new Error(`Unsupported app scaffold profile: ${profile}`);
  }
  return profile;
}

function buildPackageJson(profile, versions, identity) {
  const packageJson = {
    name: identity.packageName,
    private: false,
    type: 'module',
    publishConfig: {
      access: 'public',
    },
    scripts: {
      dev: 'pnpm run dev:renderer',
      'dev:renderer': 'vite --host 127.0.0.1 --port 1430 --strictPort',
      'dev:shell': 'tauri dev',
      typecheck: 'tsc --noEmit',
      build: 'tsc --noEmit && vite build',
      'build:shell': 'tauri build',
      test: 'node --test test/*.test.mjs',
      check: 'pnpm run doctor && pnpm run test && pnpm run validate',
      pack: 'pnpm run build && node scripts/pack.mjs',
      validate: 'node scripts/validate.mjs',
      'local-audit': 'node scripts/local-audit.mjs',
      doctor: 'nimi-app doctor',
      update: 'nimi-app update',
    },
    dependencies: {
      '@nimiplatform/sdk': profile === 'workspace-app' ? 'workspace:*' : versions.sdkVersion,
      '@nimiplatform/kit': profile === 'workspace-app' ? 'workspace:*' : versions.kitVersion,
      '@tauri-apps/api': versions.tauriApiVersion,
      react: versions.reactVersion,
      'react-dom': versions.reactDomVersion,
    },
    devDependencies: {
      '@nimiplatform/app-tools': profile === 'workspace-app' ? 'workspace:*' : versions.appToolsVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@types/node': versions.nodeTypesVersion,
      '@types/react': versions.reactTypesVersion,
      '@types/react-dom': versions.reactDomTypesVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
      typescript: versions.typescriptVersion,
      vite: versions.viteVersion,
    },
  };
  if (identity.author) {
    packageJson.author = identity.author;
  }
  return packageJson;
}

function buildRendererFiles(identity) {
  return [
    {
      path: 'src/main.tsx',
      content: [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { NimiThemeProvider } from '@nimiplatform/kit/ui';",
        "import '@nimiplatform/kit/ui/styles.css';",
        "import './styles.css';",
        "import { App } from './shell/App.js';",
        '',
        "createRoot(document.getElementById('root') as HTMLElement).render(",
        '  <React.StrictMode>',
        '    <NimiThemeProvider accentPack="nimi-accent">',
        '      <App />',
        '    </NimiThemeProvider>',
        '  </React.StrictMode>,',
        ');',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/App.tsx',
      content: [
        "import { RuntimeGate } from './auth/runtime-gate.js';",
        "import { AuthGate } from './auth/auth-gate.js';",
        "import { ProductArea } from './routes/product-area.js';",
        "import { SettingsRoute } from './routes/settings.js';",
        "import { DemoSurfaces } from './routes/demo-surfaces.js';",
        '',
        'export function App() {',
        '  return (',
        '    <RuntimeGate>',
        '      <AuthGate>',
        '        <main className="app-shell">',
        '          <ProductArea />',
        '          <aside className="side-panel">',
        '            <SettingsRoute />',
        '            <DemoSurfaces />',
        '          </aside>',
        '        </main>',
        '      </AuthGate>',
        '    </RuntimeGate>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/auth/runtime-platform.ts',
      content: [
        "import { createNimiAppRuntimePlatformClient, type NimiAppAuthProjection } from '@nimiplatform/sdk';",
        '',
        `export const appId = '${identity.appId}';`,
        `export const scaffoldProfile = '${identity.profile}' as const;`,
        '',
        'let runtimeProjection: Promise<NimiAppAuthProjection> | null = null;',
        '',
        'export function getRuntimePlatformProjection() {',
        '  runtimeProjection ??= createNimiAppRuntimePlatformClient({',
        "    mode: 'third-party-nimi-app',",
        '    appId,',
        '  });',
        '  return runtimeProjection;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/auth/auth-gate.tsx',
      content: [
        "import { useEffect, useState, type ReactNode } from 'react';",
        "import type { NimiAppAuthProjection } from '@nimiplatform/sdk';",
        "import { InlineAlert, StatusBadge } from '@nimiplatform/kit/ui';",
        "import { getRuntimePlatformProjection } from './runtime-platform.js';",
        '',
        'export function AuthGate({ children }: { children: ReactNode }) {',
        "  const [projection, setProjection] = useState<NimiAppAuthProjection | null>(null);",
        '  useEffect(() => {',
        '    let active = true;',
        '    void getRuntimePlatformProjection().then((nextProjection) => {',
        '      if (active) setProjection(nextProjection);',
        '    });',
        '    return () => {',
        '      active = false;',
        '    };',
        '  }, []);',
        '',
        '  if (!projection) {',
        "    return <div className=\"gate-panel\"><StatusBadge tone=\"neutral\">Runtime check</StatusBadge></div>;",
        '  }',
        '',
        "  if (projection.status !== 'ready') {",
        '    return (',
        '      <div className="gate-panel">',
        '        <InlineAlert tone="warning">',
        '          <strong>Runtime action required</strong>',
        '          <span>{projection.message}</span>',
        '        </InlineAlert>',
        '      </div>',
        '    );',
        '  }',
        '',
        '  return <>{children}</>;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/auth/runtime-gate.tsx',
      content: [
        "import type { ReactNode } from 'react';",
        "import { StatusBadge } from '@nimiplatform/kit/ui';",
        '',
        'export function RuntimeGate({ children }: { children: ReactNode }) {',
        '  return (',
        '    <section className="runtime-frame" aria-label="Runtime readiness gate">',
        '      <header className="runtime-frame__header">',
        `        <strong>${identity.appTitle}</strong>`,
        '        <StatusBadge tone="neutral">pre-submission self-check</StatusBadge>',
        '      </header>',
        '      {children}',
        '    </section>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/routes/product-area.tsx',
      content: [
        "import { Button, Surface } from '@nimiplatform/kit/ui';",
        '',
        'export function ProductArea() {',
        '  return (',
        '    <Surface className="product-area">',
        '      <p className="eyebrow">app-owned product route</p>',
        `      <h1>${identity.appTitle}</h1>`,
        '      <p>Replace this route with app product behavior while keeping auth, Runtime, and permission boundaries in scaffold-managed glue.</p>',
        '      <Button type="button">Open product action</Button>',
        '    </Surface>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/routes/settings.tsx',
      content: [
        "import { Surface, Toggle } from '@nimiplatform/kit/ui';",
        '',
        'export function SettingsRoute() {',
        '  return (',
        '    <Surface className="panel-section">',
        '      <h2>Settings</h2>',
        '      <label className="setting-row">',
        '        <span>Use local draft data</span>',
        '        <Toggle checked={false} onChange={() => {}} />',
        '      </label>',
        '    </Surface>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/shell/routes/demo-surfaces.tsx',
      content: [
        "import { EmptyState, Surface } from '@nimiplatform/kit/ui';",
        '',
        'export function DemoSurfaces() {',
        '  return (',
        '    <Surface className="panel-section">',
        '      <h2>Demo</h2>',
        '      <EmptyState title="Add app-owned surfaces" description="Use reviewed SDK and kit imports only." />',
        '    </Surface>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/styles.css',
      content: [
        ':root {',
        '  color-scheme: light;',
        '  font-family: Inter, ui-sans-serif, system-ui, sans-serif;',
        '}',
        '',
        'body {',
        '  margin: 0;',
        '  background: #f6f7f9;',
        '  color: #20242c;',
        '}',
        '',
        '.runtime-frame {',
        '  min-height: 100vh;',
        '  padding: 24px;',
        '}',
        '',
        '.runtime-frame__header, .app-shell {',
        '  display: grid;',
        '  gap: 16px;',
        '}',
        '',
        '.runtime-frame__header {',
        '  grid: auto / 1fr auto;',
        '  align-items: center;',
        '  margin-bottom: 16px;',
        '}',
        '',
        '.app-shell {',
        '  grid: auto / minmax(0, 1fr) minmax(280px, 360px);',
        '}',
        '',
        '.product-area, .panel-section, .gate-panel {',
        '  padding: 20px;',
        '}',
        '',
        '.side-panel {',
        '  display: grid;',
        '  align-content: start;',
        '  gap: 16px;',
        '}',
        '',
        '.eyebrow {',
        '  margin: 0 0 8px;',
        '  color: #5b6472;',
        '  font-size: 12px;',
        '  text-transform: uppercase;',
        '}',
        '',
        '.setting-row {',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: space-between;',
        '  gap: 12px;',
        '}',
        '',
        '@media (max-width: 820px) {',
        '  .app-shell, .runtime-frame__header {',
        '    grid: auto / 1fr;',
        '  }',
        '}',
        '',
      ].join('\n'),
    },
  ];
}

function buildCommonFiles(identity, versions) {
  return [
    {
      path: 'package.json',
      content: jsonFile(buildPackageJson(identity.profile, versions, identity)),
    },
    {
      path: 'tsconfig.json',
      content: jsonFile({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['node'],
        },
        include: ['src/**/*.ts', 'src/**/*.tsx', 'test/**/*.mjs'],
      }),
    },
    {
      path: 'index.html',
      content: [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${identity.appTitle}</title>`,
        '  </head>',
        '  <body>',
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.tsx"></script>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
    },
    {
      path: 'vite.config.ts',
      content: [
        "import { defineConfig } from 'vite';",
        "import react from '@vitejs/plugin-react';",
        '',
        'export default defineConfig({',
        '  plugins: [react()],',
        '});',
        '',
      ].join('\n'),
    },
    {
      path: 'nimi.app.yaml',
      content: [
        `app_id: ${identity.appId}`,
        `display_name: ${identity.appTitle}`,
        `profile: ${identity.profile}`,
        'manifest_role: submitted-input',
        'permissions:',
        '  declared_nimi_api_scopes:',
        '    - scope: app.local.drafts',
        '      qualifier: app-local-drafts',
        '      purpose: Store drafts owned by this app during author testing.',
        '',
      ].join('\n'),
    },
    {
      path: '.nimi/admission/submission.yaml',
      content: [
        `app_id: ${identity.appId}`,
        `display_name: ${identity.appTitle}`,
        `profile: ${identity.profile}`,
        `npm_package_name: ${identity.packageName}`,
        `cargo_package_name: ${identity.cargoPackageName}`,
        `tauri_identifier: ${identity.tauriIdentifier}`,
        ...(identity.author ? [`package_author: ${identity.author}`] : []),
        'submission_role: developer-submitted-input',
        'publish_readiness:',
        '  install_command: pnpm install',
        '  dev_shell_command: pnpm dev:shell',
        '  build_command: pnpm run build',
        '  pack_command: pnpm run pack',
        'review_inputs:',
        '  manifest: nimi.app.yaml',
        '  build_profile: .nimi/config/build-profile.yaml',
        '  scaffold_boundary: .nimi/contracts/scaffold-boundary.yaml',
        '  local_audit: pnpm run local-audit',
        'admission_truth: platform-owned-after-review',
        '',
      ].join('\n'),
    },
    {
      path: '.nimi/config/app-identity.yaml',
      content: [
        `app_id: ${identity.appId}`,
        `display_name: ${identity.appTitle}`,
        `npm_package_name: ${identity.packageName}`,
        `cargo_package_name: ${identity.cargoPackageName}`,
        `tauri_identifier: ${identity.tauriIdentifier}`,
        ...(identity.author ? [`package_author: ${identity.author}`] : []),
        'identity_role: scaffold-generated-authoring-input',
        '',
      ].join('\n'),
    },
    {
      path: '.nimi/config/build-profile.yaml',
      content: [
        'build_profile_ref: tauri-pnpm-vite',
        'toolchain_version: node>=20;pnpm>=9;rust>=1.80;tauri=2',
        'build_command: pnpm run build',
        'output_path: src-tauri/target/release',
        'lockfile_path: pnpm-lock.yaml',
        `lockfile_policy: ${LOCKFILE_POLICY}`,
        'ci_install_command: pnpm install --no-frozen-lockfile',
        'profile_role: developer-workflow-input',
        '',
      ].join('\n'),
    },
    {
      path: '.nimi/contracts/scaffold-boundary.yaml',
      content: [
        'scaffold_contract: P-SCAF',
        `profile: ${identity.profile}`,
        'public_admission_truth: not-generated',
        'local_audit_role: pre-submission-self-check',
        'permission_declarations: transparency-input-only',
        '',
      ].join('\n'),
    },
    {
      path: '.nimi/methodology/scaffold-managed-files.yaml',
      content: [
        'mutation_classes:',
        '  package_owned_projection:',
        '    - .nimi/config/**',
        '    - .nimi/contracts/**',
        '    - .nimi/methodology/**',
        '    - .nimi/admission/**',
        '  scaffold_managed_glue:',
        '    - .github/**',
        '    - .gitignore',
        '    - package.json',
        '    - ADMISSION.md',
        '    - README.md',
        '    - SECURITY.md',
        '    - nimi.app.yaml',
        '    - src/shell/auth/**',
        '    - src-tauri/**',
        '    - scripts/**',
        '  app_owned_product_code:',
        '    - src/shell/routes/product-area.tsx',
        '',
      ].join('\n'),
    },
    {
      path: 'AGENTS.md',
      content: [
        '# AGENTS.md',
        '- Treat `.nimi/**` as host-local scaffold truth for this generated app.',
        '- Keep auth, Runtime, permission, manifest, and Tauri shell glue in scaffold-managed files.',
        '- The app-owned area is `src/shell/routes/product-area.tsx` unless a later scaffold update expands it.',
        '- `.nimi/admission/**` and `ADMISSION.md` are developer-submitted review inputs, not platform admission truth.',
        '- Local checks are pre-submission self-checks only.',
        '',
      ].join('\n'),
    },
    {
      path: '.gitignore',
      content: [
        'node_modules/',
        'dist/',
        'src-tauri/target/',
        '.turbo/',
        '.vite/',
        '.DS_Store',
        '',
      ].join('\n'),
    },
    {
      path: 'README.md',
      content: [
        `# ${identity.appTitle}`,
        '',
        `Profile: \`${identity.profile}\``,
        '',
        'This repository is a Nimi App authoring scaffold. `nimi.app.yaml`, the build profile, permission declarations, pack output, validate output, and local audit output are submitted inputs and pre-submission self-checks only.',
        '',
        '## Development',
        '',
        '```bash',
        'pnpm install',
        'pnpm dev:shell',
        'pnpm run validate',
        'pnpm run local-audit',
        'pnpm run pack',
        'pnpm run doctor',
        'pnpm run update',
        '```',
        '',
        '`doctor` and `update` are developer scaffold checks for this source repository. They do not update an installed app, publish admission truth, create release descriptors, or grant permissions.',
        '',
        'For Nimi listing review, keep `nimi.app.yaml`, `.nimi/admission/submission.yaml`, `.nimi/config/build-profile.yaml`, and `ADMISSION.md` in sync with the product behavior under `src/shell/routes/product-area.tsx`.',
        '',
        'Upstream Platform/Runtime review produces release descriptors, ordinary visibility, install truth, and scope authorization. This scaffold does not mint those outcomes.',
        '',
      ].join('\n'),
    },
    {
      path: 'ADMISSION.md',
      content: [
        `# ${identity.appTitle} Nimi Listing Request`,
        '',
        'This document is a developer-submitted listing request. It is not an approval, release descriptor, permission grant, or install truth.',
        '',
        '## Developer Runbook',
        '',
        '```bash',
        'pnpm install',
        'pnpm dev:shell',
        'pnpm run check',
        'pnpm run pack',
        '```',
        '',
        '## Submission Inputs',
        '',
        '- `nimi.app.yaml` declares app identity and requested API scopes.',
        '- `.nimi/admission/submission.yaml` records publish-readiness commands and review inputs.',
        '- `.nimi/config/build-profile.yaml` records install, build, and lockfile policy.',
        '- `dist/nimi-app-submission.json` is produced by `pnpm run pack` after a successful renderer build.',
        '',
        '## Reviewer Boundary',
        '',
        'Nimi Platform review owns final admission, release descriptors, ordinary-user visibility, install availability, and permission grants.',
        '',
      ].join('\n'),
    },
    {
      path: 'LICENSE',
      content: [
        'MIT License',
        '',
        `Copyright (c) ${SCAFFOLD_LICENSE_YEAR} ${identity.appTitle}`,
        '',
        'Permission is hereby granted, free of charge, to any person obtaining a copy',
        'of this software and associated documentation files to deal in the Software',
        'without restriction, including without limitation the rights to use, copy,',
        'modify, merge, publish, distribute, sublicense, and/or sell copies of the',
        'Software, and to permit persons to whom the Software is furnished to do so.',
        '',
      ].join('\n'),
    },
    {
      path: 'SECURITY.md',
      content: [
        '# Security',
        '',
        '- Do not store Realm credentials or app-owned bearer credentials in this repository.',
        '- Use `createNimiAppRuntimePlatformClient` for Runtime platform projection.',
        '- Treat permission declarations as review transparency, not grants.',
        '',
      ].join('\n'),
    },
    {
      path: 'scripts/validate.mjs',
      content: [
        "import { readFileSync } from 'node:fs';",
        '',
        "const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');",
        "const submission = readFileSync(new URL('../.nimi/admission/submission.yaml', import.meta.url), 'utf8');",
        "if (!manifest.includes('manifest_role: submitted-input')) {",
        "  throw new Error('submitted manifest role marker missing');",
        '}',
        "if (!submission.includes('submission_role: developer-submitted-input')) {",
        "  throw new Error('developer submission role marker missing');",
        '}',
        "if (!submission.includes('dev_shell_command: pnpm dev:shell')) {",
        "  throw new Error('dev shell command marker missing');",
        '}',
        "console.log('[nimi-app] validate pre-submission self-check passed');",
        '',
      ].join('\n'),
    },
    {
      path: 'scripts/local-audit.mjs',
      content: [
        "import { readFileSync } from 'node:fs';",
        '',
        "const boundary = readFileSync(new URL('../.nimi/contracts/scaffold-boundary.yaml', import.meta.url), 'utf8');",
        "if (!boundary.includes('local_audit_role: pre-submission-self-check')) {",
        "  throw new Error('local audit role marker missing');",
        '}',
        "console.log('[nimi-app] local-audit pre-submission self-check passed');",
        '',
      ].join('\n'),
    },
    {
      path: 'scripts/pack.mjs',
      content: [
        "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        '',
        "if (!existsSync(join('dist', 'index.html'))) {",
        "  throw new Error('renderer build output missing: run pnpm run build before packing');",
        '}',
        "const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));",
        "const tauriConfig = JSON.parse(readFileSync(join('src-tauri', 'tauri.conf.json'), 'utf8'));",
        "const manifest = readFileSync('nimi.app.yaml', 'utf8');",
        "const submission = readFileSync(join('.nimi', 'admission', 'submission.yaml'), 'utf8');",
        "if (!manifest.includes('manifest_role: submitted-input')) {",
        "  throw new Error('submitted manifest role marker missing');",
        '}',
        "if (!submission.includes('submission_role: developer-submitted-input')) {",
        "  throw new Error('developer submission role marker missing');",
        '}',
        "mkdirSync('dist', { recursive: true });",
        'const packet = {',
        "  packetRole: 'developer-submitted-input',",
        '  packageName: packageJson.name,',
        '  appVersion: tauriConfig.version,',
        '  tauriIdentifier: tauriConfig.identifier,',
        "  rendererEntry: 'dist/index.html',",
        "  manifestPath: 'nimi.app.yaml',",
        "  admissionRequestPath: '.nimi/admission/submission.yaml',",
        "  generatedBy: '@nimiplatform/app-tools',",
        '};',
        "writeFileSync(join('dist', 'nimi-app-submission.json'), `${JSON.stringify(packet, null, 2)}\\n`);",
        "console.log('[nimi-app] pack wrote dist/nimi-app-submission.json');",
        '',
      ].join('\n'),
    },
    {
      path: 'test/scaffold-boundary.test.mjs',
      content: [
        "import assert from 'node:assert/strict';",
        "import { readFileSync } from 'node:fs';",
        "import test from 'node:test';",
        '',
        "const authSource = readFileSync(new URL('../src/shell/auth/runtime-platform.ts', import.meta.url), 'utf8');",
        "const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');",
        "const submission = readFileSync(new URL('../.nimi/admission/submission.yaml', import.meta.url), 'utf8');",
        '',
        "test('auth glue uses Nimi App runtime platform helper', () => {",
        "  assert.match(authSource, /createNimiAppRuntimePlatformClient/);",
        "  assert.doesNotMatch(authSource, /createPlatformClient\\s*\\(/);",
        "});",
        '',
        "test('manifest remains submitted input', () => {",
        "  assert.match(manifest, /manifest_role: submitted-input/);",
        "  assert.match(manifest, /declared_nimi_api_scopes/);",
        "});",
        '',
        "test('admission request remains submitted input', () => {",
        "  assert.match(submission, /submission_role: developer-submitted-input/);",
        "  assert.match(submission, /dev_shell_command: pnpm dev:shell/);",
        "  assert.match(submission, /admission_truth: platform-owned-after-review/);",
        "});",
        '',
      ].join('\n'),
    },
    {
      path: '.github/workflows/ci.yml',
      content: [
        'name: pre-submission-self-check',
        'on:',
        '  pull_request:',
        '  push:',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: pnpm/action-setup@v4',
        '        with:',
        '          version: 9',
        '      - uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 22',
        '      - run: pnpm install --no-frozen-lockfile',
        '      - run: pnpm run check',
        '',
      ].join('\n'),
    },
  ];
}

function buildTauriFiles(identity, versions) {
  const shellDependency = identity.profile === 'workspace-app'
    ? '{ path = "../../../kit/shell/tauri" }'
    : `"${versions.nimiShellTauriVersion}"`;
  return [
    {
      path: 'src-tauri/Cargo.toml',
      content: [
        '[package]',
        `name = "${identity.cargoPackageName}"`,
        'version = "0.1.0"',
        'edition = "2021"',
        '',
        '[dependencies]',
        'tauri = "2"',
        `nimi-shell-tauri = ${shellDependency}`,
        '',
        '[build-dependencies]',
        'tauri-build = { version = "2", features = [] }',
        '',
      ].join('\n'),
    },
    {
      path: 'src-tauri/build.rs',
      content: [
        'fn main() {',
        '    tauri_build::build();',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src-tauri/tauri.conf.json',
      content: jsonFile({
        productName: identity.appTitle,
        version: '0.1.0',
        identifier: identity.tauriIdentifier,
        build: {
          beforeDevCommand: 'pnpm run dev:renderer',
          beforeBuildCommand: 'pnpm run build',
          devUrl: 'http://localhost:1430',
          frontendDist: '../dist',
        },
        app: {
          windows: [
            {
              title: identity.appTitle,
              width: 1120,
              height: 760,
            },
          ],
        },
        bundle: {
          icon: ['icons/icon.png'],
        },
      }),
    },
    {
      path: 'src-tauri/icons/icon.png',
      content: MINIMAL_TAURI_ICON_PNG,
    },
    {
      path: 'src-tauri/src/main.rs',
      content: [
        'fn main() {',
        '    tauri::Builder::default()',
        '        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler![])',
        '        .run(tauri::generate_context!())',
        '        .expect("failed to run Nimi App shell");',
        '}',
        '',
      ].join('\n'),
    },
  ];
}

function buildWorkspaceAppFiles(identity) {
  return [
    {
      path: `apps/${identity.packageName}/spec/app-slice.md`,
      content: [
        `# ${identity.appId} App Slice`,
        '',
        'Workspace-app profile input under P-APP authority. This app-slice file is not public Nimi App admission and does not create ordinary-user visibility.',
        '',
      ].join('\n'),
    },
  ];
}

function buildScaffoldFiles(identity, versions) {
  return [
    ...buildCommonFiles(identity, versions),
    ...buildRendererFiles(identity),
    ...buildTauriFiles(identity, versions),
    ...(identity.profile === 'workspace-app' ? buildWorkspaceAppFiles(identity) : []),
  ];
}

function normalizePathList(paths) {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function classifyScaffoldFile(filePath) {
  if (filePath === 'src/shell/routes/product-area.tsx') {
    return 'app-owned product code';
  }
  if (
    filePath.startsWith('.nimi/config/')
    || filePath.startsWith('.nimi/contracts/')
    || filePath.startsWith('.nimi/methodology/')
    || filePath.startsWith('.nimi/admission/')
    || /^apps\/[^/]+\/spec\//.test(filePath)
  ) {
    return 'package-owned projection';
  }
  return 'scaffold-managed glue';
}

export function hashScaffoldContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function buildDependencyMatrix(profile, versions) {
  return {
    npm: {
      '@nimiplatform/app-tools': profile === 'workspace-app' ? 'workspace:*' : versions.appToolsVersion,
      '@nimiplatform/sdk': profile === 'workspace-app' ? 'workspace:*' : versions.sdkVersion,
      '@nimiplatform/kit': profile === 'workspace-app' ? 'workspace:*' : versions.kitVersion,
      '@tauri-apps/api': versions.tauriApiVersion,
      react: versions.reactVersion,
      'react-dom': versions.reactDomVersion,
      typescript: versions.typescriptVersion,
      vite: versions.viteVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
    },
    cargo: {
      'nimi-shell-tauri': profile === 'workspace-app'
        ? { path: '../../../kit/shell/tauri' }
        : versions.nimiShellTauriVersion,
      tauri: '2',
      'tauri-build': '2',
    },
    toolchain: {
      node: '>=20',
      pnpm: '>=9',
      rust: '>=1.80',
      tauri: '2',
    },
  };
}

function buildScaffoldLock(identity, versions, files) {
  const taxonomy = {
    'package-owned projection': [],
    'scaffold-managed glue': [],
    'app-owned product code': [],
  };
  const managedFileHashes = {};
  const appOwnedInitialHashes = {};

  for (const file of files) {
    const mutationClass = classifyScaffoldFile(file.path);
    taxonomy[mutationClass].push(file.path);
    const digest = hashScaffoldContent(file.content);
    if (mutationClass === 'app-owned product code') {
      appOwnedInitialHashes[file.path] = {
        class: mutationClass,
        sha256: digest,
      };
      continue;
    }
    managedFileHashes[file.path] = {
      class: mutationClass,
      sha256: digest,
    };
  }

  return {
    lockVersion: 1,
    scaffoldVersion: SCAFFOLD_VERSION,
    profile: identity.profile,
    appId: identity.appId,
    appTitle: identity.appTitle,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    appIdentity: {
      appId: identity.appId,
      appTitle: identity.appTitle,
      npmPackageName: identity.packageName,
      packageAuthor: identity.author || null,
      cargoPackageName: identity.cargoPackageName,
      tauriIdentifier: identity.tauriIdentifier,
      identityRole: 'scaffold-generated-authoring-input',
    },
    managedFileTaxonomy: {
      packageOwnedProjection: normalizePathList(taxonomy['package-owned projection']),
      scaffoldManagedGlue: normalizePathList(taxonomy['scaffold-managed glue']),
      appOwnedProductCode: normalizePathList(taxonomy['app-owned product code']),
    },
    managedFileHashes,
    appOwnedInitialHashes,
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions),
    semantics: {
      doctorAndUpdateRole: 'developer-scaffold-check-only',
      publicAdmissionTruth: 'not-generated',
      installedAppUpdateTruth: 'not-generated',
      permissionGrantTruth: 'not-generated',
      lockfilePolicy: LOCKFILE_POLICY,
      ignoredVerificationArtifacts: ['dist/'],
    },
  };
}

export function buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author }) {
  const identity = buildAppIdentity(profile, appId, appTitle, packageName, author);
  const files = buildScaffoldFiles(identity, versions);
  const lock = buildScaffoldLock(identity, versions, files);
  const allFiles = [
    ...files,
    {
      path: SCAFFOLD_LOCK_PATH,
      content: jsonFile(lock),
    },
  ];
  return {
    appId: identity.appId,
    appTitle: identity.appTitle,
    profile: identity.profile,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    files: allFiles,
    filesWithoutLock: files,
    lock,
    filesByPath: new Map(allFiles.map((file) => [file.path, file])),
  };
}

export function createAppScaffold(input) {
  const { cwd, options, versions, createFileTree, ensureDirEmptyOrMissing } = input;
  const profile = resolveProfile(options);
  const appId = resolveAppId(options);
  const appTitle = String(options.title || options.name || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
  const packageName = resolvePackageName(options, appId);
  const author = String(options.author || '').trim();
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || appId);
  ensureDirEmptyOrMissing(targetDir);
  input.mkdirSync(targetDir, { recursive: true });
  const snapshot = buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author });
  createFileTree(targetDir, snapshot.files);
  process.stdout.write(`[nimi-app] created ${profile} app scaffold at ${targetDir}\n`);
}
