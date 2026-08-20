import path from 'node:path';
import { createHash } from 'node:crypto';
import { readAppSourceFile, resolveAppSource } from '../scripts/sync-app-source.mjs';
import { loadDefaultStarterSource, readDefaultStarterSourceFile } from './app-scaffold-default-source.mjs';
import { normalizeAppAccessItems } from './app-access-declaration.mjs';
import { resolveAppScaffoldFeatures } from './app-scaffold-capabilities.mjs';
import {
  SUPPORTED_APP_SCAFFOLD_PROFILES,
  buildDefaultStarterFiles,
} from './app-scaffold-profiles.mjs';
export { SUPPORTED_APP_SCAFFOLD_PROFILES };
const DEFAULT_APP_ID = 'my-nimi-app';
const DEFAULT_APP_TITLE = 'My Nimi App';
export const SCAFFOLD_VERSION = '2026-08-20.capability-selection-v1';
export const SCAFFOLD_STATE_DIR = '.nimi/app-scaffold';
export const SCAFFOLD_INTENT_PATH = `${SCAFFOLD_STATE_DIR}/intent.json`;
export const SCAFFOLD_LOCK_PATH = `${SCAFFOLD_STATE_DIR}/lock.json`;
const LOCKFILE_POLICY = 'author-install-generates-lockfile';
const GENERATED_GITIGNORE = [
  'node_modules/',
  'dist/',
  'dist-electron/',
  'src-tauri/target/',
  '.env.local',
  '.env.*.local',
  '.nimi/local/',
  '.turbo/',
  '.vite/',
  '.DS_Store',
  '',
].join('\n');
const MINIMAL_TAURI_ICON_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
const MINIMAL_TAURI_ICON_ICO = Buffer.from('AAABAAEAAQEAAAEAIABEAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAABAAAAAQgGAAAAHxXEiQAAAAtJREFUeJxjYAACAAAFAAF6Xqs/AAAAAElFTkSuQmCC', 'base64');

const CI_WORKFLOW = [
  'name: local-development-check',
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
  '      - run: pnpm run init',
  '      - run: pnpm run check',
  '',
].join('\n');

let appSourceCache = null;

function loadAppSource() {
  if (!appSourceCache) {
    appSourceCache = resolveAppSource();
  }
  return appSourceCache;
}

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
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(normalized)) {
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

function appSlugFromAppId(appId) {
  return packageSafeName(appId);
}

function tauriIdentifierFromAppId(appId) {
  const suffix = String(appId || DEFAULT_APP_ID)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
  return `ai.nimi.apps.${suffix || DEFAULT_APP_ID}`;
}

function deriveScaffoldDevPort(appId) {
  let hash = 0;
  for (const char of String(appId || DEFAULT_APP_ID)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100;
  }
  return 1430 + hash;
}

function buildAppIdentity(profile, appId, appTitle, packageName, author = '', accentPack = 'nimi-accent', features = undefined) {
  const resolvedPackageName = packageName || packageSafeName(appId);
  const capabilityResolution = resolveAppScaffoldFeatures(features);
  return {
    appId,
    appTitle,
    profile,
    packageName: resolvedPackageName,
    cargoPackageName: `${cargoSafeNameFromPackageName(resolvedPackageName)}-shell`,
    tauriIdentifier: tauriIdentifierFromAppId(appId),
    appSlug: appSlugFromAppId(appId),
    rendererEntryId: `${appSlugFromAppId(appId)}-app`,
    accentPack: String(accentPack || '').trim() || 'nimi-accent',
    features: capabilityResolution.featureIds,
    appAccessItems: normalizeAppAccessItems(capabilityResolution.appAccessItems),
    capabilityResolution,
    devPort: deriveScaffoldDevPort(appId),
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
    packageManager: versions.packageManager,
    publishConfig: {
      access: 'public',
    },
    pnpm: {
      onlyBuiltDependencies: ['electron', 'esbuild', 'protobufjs'],
    },
    scripts: {
      dev: 'nimi-app dev --shell electron',
      'dev:renderer': `vite --host 127.0.0.1 --port ${identity.devPort} --strictPort`,
      'dev:shell': 'nimi-app dev',
      'dev:electron': 'nimi-app dev --shell electron',
      init: 'nimi-app init',
      typecheck: 'tsc --noEmit',
      build: 'tsc --noEmit && vite build',
      'build:electron': 'tsc -p tsconfig.electron.json && node scripts/bundle-electron-preload.mjs',
      'build:shell': 'tauri build',
      postinstall: 'install-electron --no',
      check: 'pnpm run doctor && pnpm run validate',
      validate: 'node scripts/validate.mjs',
      doctor: 'nimi-app doctor',
      update: 'nimi-app update',
    },
    dependencies: {
      '@nimiplatform/sdk': profile === 'workspace-app' ? 'workspace:*' : versions.sdkVersion,
      '@nimiplatform/kit': profile === 'workspace-app' ? 'workspace:*' : versions.kitVersion,
      '@tauri-apps/api': versions.tauriApiVersion,
      i18next: versions.i18nextVersion,
      'lucide-react': versions.lucideReactVersion,
      react: versions.reactVersion,
      'react-dom': versions.reactDomVersion,
      'react-i18next': versions.reactI18nextVersion,
      ...identity.capabilityResolution.npmDependencies,
    },
    devDependencies: {
      '@nimiplatform/app-tools': profile === 'workspace-app' ? 'workspace:*' : versions.appToolsVersion,
      '@nimiplatform/nimi-coding': versions.nimicodingVersion,
      '@tailwindcss/vite': versions.tailwindcssViteVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@types/node': versions.nodeTypesVersion,
      '@types/react': versions.reactTypesVersion,
      '@types/react-dom': versions.reactDomTypesVersion,
      '@types/three': versions.threeTypesVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
      electron: versions.electronVersion,
      esbuild: versions.esbuildVersion,
      tailwindcss: versions.tailwindcssVersion,
      typescript: versions.typescriptVersion,
      vite: versions.viteVersion,
      yaml: versions.yamlVersion,
    },
  };
  if (identity.author) {
    packageJson.author = identity.author;
  }
  return packageJson;
}

function cargoShellDependencyLine(profile, versions) {
  if (profile === 'workspace-app') {
    return 'nimi-shell-tauri = { path = "../../../kit/shell/tauri" }';
  }
  return `nimi-shell-tauri = ${JSON.stringify(versions.nimiShellTauriVersion)}`;
}

function targetIdentityMap(identity) {
  return {
    tauriIdentifier: identity.tauriIdentifier,
    packageName: identity.packageName,
    cargoPackageName: identity.cargoPackageName,
    appId: identity.appId,
    appTitle: identity.appTitle,
    appSlug: identity.appSlug,
    rendererEntryId: identity.rendererEntryId,
    accentPack: identity.accentPack,
    devPort: String(identity.devPort),
  };
}

function applyIdentityReplacement(content, manifest, target) {
  let rendered = content;
  for (const field of manifest.identityReplacementOrder) {
    if (field === 'rendererEntryId') {
      continue;
    }
    const from = manifest.sourceIdentity[field];
    const to = target[field];
    if (from === undefined || to === undefined) {
      throw new Error(`Identity replacement field missing: ${field}`);
    }
    rendered = rendered.split(from).join(to);
  }
  const sourceEntryId = manifest.sourceIdentity.rendererEntryId;
  const targetEntryId = target.rendererEntryId;
  if (sourceEntryId && targetEntryId) {
    rendered = rendered.split(`entry:${sourceEntryId}`).join(`entry:${targetEntryId}`);
  }
  return rendered;
}

function renderAppAccessItems(items) {
  return items.map((item) => `  - ${JSON.stringify(item)}`);
}

function buildNimiAppManifest(identity) {
  const declarationLines = identity.appAccessItems.length === 0
    ? ['app_access: []']
    : ['app_access:', ...renderAppAccessItems(identity.appAccessItems)];
  return [
    `app_id: ${identity.appId}`,
    `display_name: ${identity.appTitle}`,
    `profile: ${identity.profile}`,
    'manifest_role: submitted-input',
    ...declarationLines,
    'local_development:',
    '  electron:',
    `    renderer_origin: http://127.0.0.1:${identity.devPort}`,
    '',
  ].join('\n');
}

function applyProfileSeam(relativePath, content, profile, versions, manifest, identity) {
  if (relativePath === 'nimi.app.yaml') {
    return buildNimiAppManifest(identity);
  }
  if (relativePath === 'src-tauri/Cargo.toml') {
    return content.replace(/^nimi-shell-tauri\s*=.*$/m, cargoShellDependencyLine(profile, versions));
  }
  return content;
}

function buildDefaultStarterTemplateFiles(identity, profile, versions) {
  const { baseDir, manifest } = loadDefaultStarterSource();
  const target = targetIdentityMap(identity);
  return manifest.files.map((entry) => {
    const raw = readDefaultStarterSourceFile(baseDir, entry.path);
    const identityApplied = applyIdentityReplacement(raw, manifest, target);
    return {
      path: entry.path,
      content: applyProfileSeam(entry.path, identityApplied, profile, versions, manifest, identity),
      mutationClass: entry.class,
    };
  });
}

function buildCapabilitySliceFiles(identity, profile, versions) {
  if (identity.capabilityResolution.capabilities.length === 0) return [];
  const { baseDir, manifest } = loadAppSource();
  const target = targetIdentityMap(identity);
  const outputPaths = new Set();
  const files = [];
  for (const capability of identity.capabilityResolution.capabilities) {
    const sourcePrefix = `${capability.sourceRoot}/`;
    const selected = manifest.files.filter((entry) => entry.path.startsWith(sourcePrefix));
    if (selected.length === 0) {
      throw new Error(`Scaffold capability source is empty: ${capability.id}`);
    }
    for (const entry of selected) {
      const suffix = entry.path.slice(sourcePrefix.length);
      const outputPath = `${capability.targetRoot}/${suffix}`;
      if (outputPaths.has(outputPath)) {
        throw new Error(`Scaffold capability output collision: ${outputPath}`);
      }
      outputPaths.add(outputPath);
      const raw = readAppSourceFile(baseDir, entry.path);
      const identityApplied = applyIdentityReplacement(raw, manifest, target);
      files.push({
        path: outputPath,
        content: applyProfileSeam(outputPath, identityApplied, profile, versions, manifest, identity),
        mutationClass: 'app-owned product code',
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function buildStructuredFiles(identity, profile, versions) {
  const files = [
    {
      path: '.gitignore',
      content: GENERATED_GITIGNORE,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'package.json',
      content: jsonFile(buildPackageJson(profile, versions, identity)),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: '.github/workflows/ci.yml',
      content: CI_WORKFLOW,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'nimi.app.yaml',
      content: buildNimiAppManifest(identity),
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-tauri/icons/icon.png',
      content: MINIMAL_TAURI_ICON_PNG,
      mutationClass: 'scaffold-managed glue',
    },
    {
      path: 'src-tauri/icons/icon.ico',
      content: MINIMAL_TAURI_ICON_ICO,
      mutationClass: 'scaffold-managed glue',
    },
  ];
  return files;
}

function buildScaffoldIntent(identity, versions) {
  return {
    intentVersion: 2,
    scaffoldVersion: SCAFFOLD_VERSION,
    initRequired: true,
    initCommand: 'pnpm exec nimi-app init',
    initOrder: ['nimi-app create', 'pnpm install', 'pnpm exec nimi-app init'],
    profile: identity.profile,
    appId: identity.appId,
    appTitle: identity.appTitle,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    accentPack: identity.accentPack,
    features: identity.features,
    appAccessItems: identity.appAccessItems,
    devPort: identity.devPort,
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions, identity.capabilityResolution),
    semantics: {
      role: 'app-scaffold-init-input',
      authority: 'app-tools-orchestration-input-not-platform-admission',
      nimicodingProjectionOwner: '@nimiplatform/nimi-coding',
    },
  };
}

function buildScaffoldIntentFile(identity, versions) {
  return {
    path: SCAFFOLD_INTENT_PATH,
    content: jsonFile(buildScaffoldIntent(identity, versions)),
    mutationClass: 'scaffold-managed glue',
  };
}

function buildScaffoldFiles(identity, versions) {
  return [
    ...buildStructuredFiles(identity, identity.profile, versions),
    ...buildDefaultStarterTemplateFiles(identity, identity.profile, versions),
    ...buildDefaultStarterFiles(identity),
    ...buildCapabilitySliceFiles(identity, identity.profile, versions),
  ];
}

function normalizePathList(paths) {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function hashScaffoldContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function buildDependencyMatrix(profile, versions, capabilityResolution) {
  return {
    npm: {
      '@nimiplatform/app-tools': profile === 'workspace-app' ? 'workspace:*' : versions.appToolsVersion,
      '@nimiplatform/nimi-coding': versions.nimicodingVersion,
      '@nimiplatform/sdk': profile === 'workspace-app' ? 'workspace:*' : versions.sdkVersion,
      '@nimiplatform/kit': profile === 'workspace-app' ? 'workspace:*' : versions.kitVersion,
      '@tauri-apps/api': versions.tauriApiVersion,
      i18next: versions.i18nextVersion,
      'lucide-react': versions.lucideReactVersion,
      react: versions.reactVersion,
      'react-dom': versions.reactDomVersion,
      'react-i18next': versions.reactI18nextVersion,
      typescript: versions.typescriptVersion,
      vite: versions.viteVersion,
      tailwindcss: versions.tailwindcssVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@tailwindcss/vite': versions.tailwindcssViteVersion,
      '@types/three': versions.threeTypesVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
      electron: versions.electronVersion,
      esbuild: versions.esbuildVersion,
      yaml: versions.yamlVersion,
      ...capabilityResolution.npmDependencies,
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
    const mutationClass = file.mutationClass;
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
    lockVersion: 2,
    scaffoldVersion: SCAFFOLD_VERSION,
    profile: identity.profile,
    appId: identity.appId,
    appTitle: identity.appTitle,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    accentPack: identity.accentPack,
    appAccessItems: identity.appAccessItems,
    features: identity.features,
    appIdentity: {
      appId: identity.appId,
      appTitle: identity.appTitle,
      npmPackageName: identity.packageName,
      packageAuthor: identity.author || null,
      cargoPackageName: identity.cargoPackageName,
      tauriIdentifier: identity.tauriIdentifier,
      accentPack: identity.accentPack,
      features: identity.features,
      appAccessItems: identity.appAccessItems,
      identityRole: 'scaffold-generated-authoring-input',
    },
    managedFileTaxonomy: {
      packageOwnedProjection: normalizePathList(taxonomy['package-owned projection']),
      scaffoldManagedGlue: normalizePathList(taxonomy['scaffold-managed glue']),
      appOwnedProductCode: normalizePathList(taxonomy['app-owned product code']),
    },
    managedFileHashes,
    appOwnedInitialHashes,
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions, identity.capabilityResolution),
    semantics: {
      initRole: 'developer-scaffold-initialization-after-install',
      nimicodingProjectionOwner: '@nimiplatform/nimi-coding',
      nimicodingApplyCommand: 'pnpm exec nimicoding sync --apply --json',
      nimicodingCheckCommand: 'pnpm exec nimicoding sync --check --json',
      doctorAndUpdateRole: 'developer-scaffold-check-only',
      lockfilePolicy: LOCKFILE_POLICY,
      ignoredVerificationArtifacts: ['dist/'],
      capabilityComposition: 'base-plus-selected-dependency-closure',
    },
  };
}

export function buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author, accentPack, features }) {
  const identity = buildAppIdentity(profile, appId, appTitle, packageName, author, accentPack, features);
  const createFiles = [
    ...buildScaffoldFiles(identity, versions),
    buildScaffoldIntentFile(identity, versions),
  ];
  const filesWithoutLock = [...createFiles];
  const lock = buildScaffoldLock(identity, versions, filesWithoutLock);
  const initFiles = [
    {
      path: SCAFFOLD_LOCK_PATH,
      content: jsonFile(lock),
      mutationClass: 'scaffold-managed glue',
    },
  ];
  const allFiles = [
    ...createFiles,
    ...initFiles,
  ];
  return {
    appId: identity.appId,
    appTitle: identity.appTitle,
    profile: identity.profile,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    features: identity.features,
    files: allFiles,
    createFiles,
    initFiles,
    filesWithoutLock,
    lock,
    filesByPath: new Map(allFiles.map((file) => [file.path, file])),
  };
}

export function buildAppScaffoldSnapshotFromIntent({ intent, versions }) {
  if (intent?.intentVersion !== 2) {
    throw new Error(`Unsupported scaffold intent version: ${String(intent?.intentVersion || 'missing')}`);
  }
  if (intent?.scaffoldVersion !== SCAFFOLD_VERSION) {
    throw new Error(`Unsupported scaffold intent version source: ${String(intent?.scaffoldVersion || 'missing')}`);
  }
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(intent?.profile)) {
    throw new Error(`Unsupported scaffold profile: ${String(intent?.profile || 'missing')}`);
  }
  return buildAppScaffoldSnapshot({
    profile: intent.profile,
    versions,
    appId: intent.appId,
    appTitle: intent.appTitle,
    packageName: intent.packageName,
    author: intent.packageAuthor || '',
    accentPack: intent.accentPack || 'nimi-accent',
    features: intent.features,
  });
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
  const snapshot = buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author, features: options.features });
  createFileTree(targetDir, snapshot.createFiles);
  process.stdout.write(`[nimi-app] created ${profile} app scaffold at ${targetDir}\n`);
  process.stdout.write('[nimi-app] next: pnpm install && pnpm run init\n');
}
