import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import {
  WORKBENCH_CORE_SOURCE_ROOT,
  readAppSourceFile,
  resolveAppSource,
} from '../scripts/sync-app-source.mjs';
import { loadDefaultStarterSource, readDefaultStarterSourceFile } from './app-scaffold-default-source.mjs';
import { normalizeAppAccessItems } from './app-access-declaration.mjs';
import {
  resolveAppScaffoldCandidateFeatures,
  resolveAppScaffoldFeatures,
  resolveAppScaffoldIntentFeatures,
} from './app-scaffold-capabilities.mjs';
import {
  SUPPORTED_APP_SCAFFOLD_PROFILES,
  buildDefaultStarterFiles,
} from './app-scaffold-profiles.mjs';
export { SUPPORTED_APP_SCAFFOLD_PROFILES };
const DEFAULT_APP_ID = 'my-nimi-app';
const DEFAULT_APP_TITLE = 'My Nimi App';
export const SCAFFOLD_INTENT_VERSION = 3;
export const SCAFFOLD_LOCK_VERSION = 3;
export const SCAFFOLD_VERSION = '2026-08-20.module-composition-v2';
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

const appSourceCache = new Map();

function loadAppSource(resolvedModuleIds = []) {
  const cacheKey = resolvedModuleIds.join('\0');
  if (!appSourceCache.has(cacheKey)) {
    appSourceCache.set(cacheKey, resolveAppSource({ resolvedModuleIds }));
  }
  return appSourceCache.get(cacheKey);
}

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(sortedJsonValue(value));
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
  const raw = String(input || '');
  if (raw !== raw.trim() || raw !== raw.toLowerCase()) {
    throw new Error(`Invalid app id: ${input}`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(raw)) {
    throw new Error(`Invalid app id: ${input}`);
  }
  return raw;
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
  const raw = String(input || '');
  const normalized = raw.trim();
  if (raw !== normalized) {
    throw new Error(`Invalid npm package name: ${input}`);
  }
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

function normalizeDisplayName(input) {
  const value = String(input ?? '');
  if (!value.trim() || value.length > 160 || /[\0\r\n]/.test(value)) {
    throw new Error('Display Name must be non-empty, at most 160 characters, and one line');
  }
  return value;
}

function normalizeAuthor(input) {
  const value = String(input ?? '');
  if (!value) return '';
  if (!value.trim() || value.length > 214 || /[\0\r\n]/.test(value)) {
    throw new Error('Author must be at most 214 characters and one line');
  }
  return value;
}

function assertNonLabIdentity(identity) {
  const normalizedTitle = identity.appTitle.trim().toLowerCase();
  const reserved = [
    identity.appId === 'nimi.lab',
    normalizedTitle === 'nimi lab',
    identity.packageName === '@nimiplatform/lab',
    identity.tauriIdentifier === 'ai.nimi.apps.nimi.lab',
    identity.cargoPackageName === 'nimiapp-lab-shell',
    identity.appSlug === 'nimi-lab',
  ];
  if (reserved.some(Boolean)) {
    throw new Error('Nimi Lab canonical identity is reserved and cannot be scaffolded');
  }
}

function deriveScaffoldDevPort(appId) {
  let hash = 0;
  for (const char of String(appId || DEFAULT_APP_ID)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100;
  }
  return 1430 + hash;
}

function buildAppIdentity(
  profile,
  appId,
  appTitle,
  packageName,
  author = '',
  accentPack = 'nimi-accent',
  features = undefined,
  featureResolver = resolveAppScaffoldFeatures,
) {
  const resolvedPackageName = packageName || packageSafeName(appId);
  const capabilityResolution = featureResolver(features);
  const identity = {
    appId,
    appTitle,
    profile,
    packageName: resolvedPackageName,
    cargoPackageName: `${cargoSafeNameFromPackageName(resolvedPackageName)}-shell`,
    tauriIdentifier: tauriIdentifierFromAppId(appId),
    nativeBundleIdentifier: tauriIdentifierFromAppId(appId),
    appSlug: appSlugFromAppId(appId),
    rendererEntryId: `${appSlugFromAppId(appId)}-app`,
    accentPack: String(accentPack || '').trim() || 'nimi-accent',
    features: capabilityResolution.resolvedFeatureIds,
    appAccessItems: normalizeAppAccessItems(capabilityResolution.appAccessItems),
    capabilityResolution,
    devPort: deriveScaffoldDevPort(appId),
    appOwnedNamespace: appId,
    author: normalizeAuthor(author),
  };
  assertNonLabIdentity(identity);
  return identity;
}

function resolveProfile(options) {
  const profile = String(options.profile || '').trim() || 'standalone';
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)) {
    throw new Error(`Unsupported app scaffold profile: ${profile}`);
  }
  return profile;
}

function resolveAppScaffoldCreateInputWithResolver(
  { cwd, options = {} },
  featureResolver,
) {
  const profile = resolveProfile(options);
  const appId = resolveAppId(options);
  const appTitle = normalizeDisplayName(options.title || options.name || DEFAULT_APP_TITLE);
  const packageName = resolvePackageName(options, appId);
  const author = normalizeAuthor(options.author || '');
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || appId);
  const identity = buildAppIdentity(
    profile,
    appId,
    appTitle,
    packageName,
    author,
    options.accentPack,
    options.features,
    featureResolver,
  );
  return Object.freeze({
    profile,
    appId,
    appTitle,
    packageName,
    author,
    accentPack: identity.accentPack,
    directFeatures: identity.capabilityResolution.directFeatureIds,
    resolvedModules: identity.capabilityResolution.resolvedModuleIds,
    features: identity.features,
    targetDir,
  });
}

export function resolveAppScaffoldCreateInput(input) {
  return resolveAppScaffoldCreateInputWithResolver(input, resolveAppScaffoldFeatures);
}

export function resolveAppScaffoldCandidateCreateInput(input) {
  return resolveAppScaffoldCreateInputWithResolver(input, resolveAppScaffoldCandidateFeatures);
}

function buildPackageJson(profile, versions, identity) {
  const dependencies = buildRuntimeDependencies(profile, versions, identity.capabilityResolution);
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
    dependencies,
    devDependencies: {
      '@nimiplatform/app-tools': versions.appToolsVersion,
      '@nimiplatform/nimi-coding': versions.nimicodingVersion,
      '@tailwindcss/vite': versions.tailwindcssViteVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@types/node': versions.nodeTypesVersion,
      '@types/react': versions.reactTypesVersion,
      '@types/react-dom': versions.reactDomTypesVersion,
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

function buildRuntimeDependencies(profile, versions, capabilityResolution) {
  const dependencies = {
    '@nimiplatform/sdk': versions.sdkVersion,
    '@nimiplatform/kit': versions.kitVersion,
    react: versions.reactVersion,
    'react-dom': versions.reactDomVersion,
  };
  for (const [name, version] of Object.entries(capabilityResolution.npmDependencies)) {
    const resolvedVersion = resolveScaffoldVersionReference(version, versions, name);
    if (Object.hasOwn(dependencies, name) && dependencies[name] !== resolvedVersion) {
      throw new Error(`App scaffold base/module dependency version collision for ${name}`);
    }
    dependencies[name] = resolvedVersion;
  }
  return dependencies;
}

function resolveScaffoldVersionReference(value, versions, dependencyName) {
  if (typeof value !== 'string') throw new Error(`Invalid npm dependency version for ${dependencyName}`);
  const match = value.match(/^\$versions\.([A-Za-z][A-Za-z0-9]*)$/u);
  if (!match) return value;
  const resolved = versions[match[1]];
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new Error(`Missing scaffold version source for ${dependencyName}: ${match[1]}`);
  }
  return resolved;
}

function buildCargoDependencies(profile, versions, capabilityResolution) {
  const dependencies = {
    'nimi-shell-tauri': versions.nimiShellTauriVersion,
    tauri: { version: '2', features: [] },
    serde: { version: '1', features: ['derive'] },
    serde_json: '1',
    url: '2',
    base64: '0.22',
    dirs: '6',
    time: '=0.3.47',
    'tauri-build': { version: '2', features: [] },
  };
  for (const [name, value] of Object.entries(capabilityResolution.cargoDependencies || {})) {
    if (Object.hasOwn(dependencies, name) && canonicalJson(dependencies[name]) !== canonicalJson(value)) {
      throw new Error(`App scaffold base/module Cargo dependency collision for ${name}`);
    }
    dependencies[name] = value;
  }
  return dependencies;
}

function cargoShellDependencyLine(profile, versions) {
  return `nimi-shell-tauri = ${JSON.stringify(versions.nimiShellTauriVersion)}`;
}

export function renderCargoDependencyValue(value, label) {
  if (typeof value === 'string' && value.trim() === value && value) {
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Cargo dependency descriptor: ${label}`);
  }
  const allowedKeys = new Set(['version', 'package', 'features', 'default-features', 'optional']);
  const fields = [];
  for (const key of Object.keys(value).sort()) {
    if (!allowedKeys.has(key)) throw new Error(`Invalid Cargo dependency field: ${label}.${key}`);
    const field = value[key];
    if (typeof field === 'string' && field.trim() === field && field) {
      fields.push(`${key} = ${JSON.stringify(field)}`);
      continue;
    }
    if (typeof field === 'boolean') {
      fields.push(`${key} = ${field ? 'true' : 'false'}`);
      continue;
    }
    if (Array.isArray(field) && field.every((item) => typeof item === 'string' && item.trim() === item && item)) {
      fields.push(`${key} = [${field.map((item) => JSON.stringify(item)).join(', ')}]`);
      continue;
    }
    throw new Error(`Invalid Cargo dependency value: ${label}.${key}`);
  }
  if (fields.length === 0) throw new Error(`Invalid empty Cargo dependency descriptor: ${label}`);
  return `{ ${fields.join(', ')} }`;
}

function renderCargoManifest(content, profile, versions, capabilityResolution) {
  let rendered = content.replace(
    /^nimi-shell-tauri\s*=.*$/m,
    cargoShellDependencyLine(profile, versions),
  );
  const baseNames = new Set([
    'tauri',
    'nimi-shell-tauri',
    'serde',
    'serde_json',
    'url',
    'base64',
    'dirs',
    'time',
    'tauri-build',
  ]);
  const additions = [];
  for (const [name, value] of Object.entries(capabilityResolution.cargoDependencies || {})) {
    if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error(`Invalid Cargo dependency name: ${name}`);
    if (baseNames.has(name)) continue;
    additions.push(`${name} = ${renderCargoDependencyValue(value, name)}`);
  }
  if (additions.length === 0) return rendered;
  const marker = '\n[build-dependencies]';
  if (!rendered.includes(marker)) throw new Error('Generated Cargo manifest is missing [build-dependencies]');
  rendered = rendered.replace(marker, `\n${additions.join('\n')}\n${marker}`);
  return rendered;
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

export function assertIdentityNeutralProductSource(relativePath, content, manifest) {
  const forbidden = [
    'tauriIdentifier',
    'packageName',
    'cargoPackageName',
    'appId',
    'appTitle',
    'appSlug',
    'rendererEntryId',
  ];
  for (const field of forbidden) {
    const value = manifest.sourceIdentity?.[field];
    if (typeof value === 'string' && value && content.includes(value)) {
      throw new Error(`Scaffold product source contains reserved Lab identity: ${relativePath}: ${field}`);
    }
  }
  if (/\bLab-only\b/u.test(content)) {
    throw new Error(`Scaffold product source contains a Lab-only marker: ${relativePath}`);
  }
}

function relativeModuleSpecifier(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function rewriteMappedModuleSpecifiers(content, sourcePath, outputPath, mappings) {
  if (!/\.[cm]?[jt]sx?$/u.test(sourcePath)) return content;
  const pattern = /(\b(?:from|import)\s*(?:\(\s*)?)(['"])(\.\.?\/[^'"]+)\2(\s*\)?)/gu;
  return content.replace(pattern, (whole, prefix, quote, specifier, suffix) => {
    const resolvedSource = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
    const owner = mappings.find((mapping) => (
      resolvedSource === mapping.sourceRoot
      || resolvedSource.startsWith(`${mapping.sourceRoot}/`)
    ));
    if (!owner) {
      throw new Error(`Scaffold product import escapes resolved source ownership: ${sourcePath}: ${specifier}`);
    }
    const sourceSuffix = resolvedSource === owner.sourceRoot
      ? ''
      : resolvedSource.slice(owner.sourceRoot.length + 1);
    const resolvedTarget = sourceSuffix
      ? `${owner.targetRoot}/${sourceSuffix}`
      : owner.targetRoot;
    const rewritten = relativeModuleSpecifier(outputPath, resolvedTarget);
    return `${prefix}${quote}${rewritten}${quote}${suffix}`;
  });
}

function buildNimiAppManifest(identity) {
  return YAML.stringify({
    app_id: identity.appId,
    display_name: identity.appTitle,
    profile: identity.profile,
    manifest_role: 'submitted-input',
    app_access: identity.appAccessItems,
    local_development: {
      electron: {
        renderer_origin: `http://127.0.0.1:${identity.devPort}`,
      },
    },
  }, { lineWidth: 0 });
}

function renderTauriConfig(raw, identity) {
  const config = JSON.parse(raw);
  config.productName = identity.appTitle;
  config.identifier = identity.nativeBundleIdentifier;
  config.build = { ...config.build, devUrl: `http://127.0.0.1:${identity.devPort}` };
  config.app = {
    ...config.app,
    windows: Array.isArray(config.app?.windows)
      ? config.app.windows.map((window) => ({ ...window, title: identity.appTitle }))
      : [],
  };
  return jsonFile(config);
}

function renderAppIdentityModule(identity) {
  return [
    `export const appId = ${JSON.stringify(identity.appId)};`,
    `export const appTitle = ${JSON.stringify(identity.appTitle)};`,
    `export const scaffoldProfile = ${JSON.stringify(identity.profile)} as const;`,
    `export const nativeBundleIdentifier = ${JSON.stringify(identity.nativeBundleIdentifier)};`,
    '',
  ].join('\n');
}

function escapeHtmlText(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderIdentitySensitiveStarterFile(relativePath, raw, manifest, identity) {
  if (relativePath === 'src-tauri/tauri.conf.json') {
    return renderTauriConfig(raw, identity);
  }
  if (relativePath === 'src/shell/auth/app-identity.ts') {
    return renderAppIdentityModule(identity);
  }
  if (relativePath === 'index.html') {
    return raw.split(manifest.sourceIdentity.appTitle).join(escapeHtmlText(identity.appTitle));
  }
  return applyIdentityReplacement(raw, manifest, targetIdentityMap(identity));
}

function applyProfileSeam(relativePath, content, profile, versions, manifest, identity) {
  if (relativePath === 'nimi.app.yaml') {
    return buildNimiAppManifest(identity);
  }
  if (relativePath === 'src-tauri/Cargo.toml') {
    return renderCargoManifest(content, profile, versions, identity.capabilityResolution);
  }
  if (relativePath === 'README.md') {
    return content.replace(/Profile: `standalone`/, `Profile: \`${profile}\``);
  }
  return content;
}

function buildDefaultStarterTemplateFiles(identity, profile, versions) {
  const { baseDir, manifest } = loadDefaultStarterSource();
  const target = targetIdentityMap(identity);
  return manifest.files.map((entry) => {
    const raw = readDefaultStarterSourceFile(baseDir, entry.path);
    const identityApplied = renderIdentitySensitiveStarterFile(entry.path, raw, manifest, identity);
    return {
      path: entry.path,
      content: applyProfileSeam(entry.path, identityApplied, profile, versions, manifest, identity),
      mutationClass: entry.class,
    };
  });
}

function buildCapabilitySliceFiles(identity, profile, versions) {
  if (identity.capabilityResolution.modules.length === 0) return [];
  const { baseDir, manifest } = loadAppSource(identity.capabilityResolution.resolvedModuleIds);
  const mappings = identity.capabilityResolution.modules.flatMap((module) => (
    module.sourceMappings.map((mapping) => ({ ...mapping, ownerId: module.id }))
  ));
  const outputPaths = new Set();
  const files = [];
  for (const module of identity.capabilityResolution.modules) {
    for (const mapping of module.sourceMappings) {
      const sourcePrefix = `${mapping.sourceRoot}/`;
      const selected = manifest.files.filter((entry) => entry.path.startsWith(sourcePrefix));
      if (selected.length === 0) {
        throw new Error(`App scaffold module source is empty: ${module.id}: ${mapping.sourceRoot}`);
      }
      for (const entry of selected) {
        const suffix = entry.path.slice(sourcePrefix.length);
        const outputPath = `${mapping.targetRoot}/${suffix}`;
        if (outputPaths.has(outputPath)) {
          throw new Error(`App scaffold module output collision: ${outputPath}`);
        }
        outputPaths.add(outputPath);
        const raw = readAppSourceFile(baseDir, entry.path);
        assertIdentityNeutralProductSource(entry.path, raw, manifest);
        const rendered = rewriteMappedModuleSpecifiers(raw, entry.path, outputPath, mappings);
        files.push({
          path: outputPath,
          content: applyProfileSeam(outputPath, rendered, profile, versions, manifest, identity),
          mutationClass: 'app-owned product code',
          ownerKind: 'module',
          ownerId: module.id,
        });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function buildWorkbenchCoreFiles(identity, profile, versions) {
  const { baseDir, manifest } = loadAppSource(identity.capabilityResolution.resolvedModuleIds);
  const sourcePrefix = `${WORKBENCH_CORE_SOURCE_ROOT}/`;
  const selected = manifest.files.filter((entry) => entry.path.startsWith(sourcePrefix));
  if (selected.length === 0) {
    throw new Error('Workbench core source is empty');
  }
  return selected.map((entry) => {
    const raw = readAppSourceFile(baseDir, entry.path);
    assertIdentityNeutralProductSource(entry.path, raw, manifest);
    return {
      path: entry.path,
      content: applyProfileSeam(entry.path, raw, profile, versions, manifest, identity),
      mutationClass: 'app-owned product code',
      ownerKind: 'skeleton',
      ownerId: 'workbench-core',
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
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

function buildIdentityMapping(identity, targetDir = '') {
  return {
    appId: identity.appId,
    displayName: identity.appTitle,
    npmPackageName: identity.packageName,
    author: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    nativeBundleIdentifier: identity.nativeBundleIdentifier,
    tauriIdentifier: identity.tauriIdentifier,
    appSlug: identity.appSlug,
    rendererEntryId: identity.rendererEntryId,
    devPort: identity.devPort,
    devRendererOrigin: `http://127.0.0.1:${identity.devPort}`,
    appOwnedNamespace: identity.appOwnedNamespace,
    targetDir: targetDir || null,
  };
}

function buildScaffoldIntent(identity, versions, targetDir = '') {
  return {
    intentVersion: SCAFFOLD_INTENT_VERSION,
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
    directFeatures: identity.capabilityResolution.directFeatureIds,
    resolvedModules: identity.capabilityResolution.resolvedModuleIds,
    resolvedViews: identity.capabilityResolution.views,
    resolvedNavigation: identity.capabilityResolution.navigation,
    resolvedStyles: identity.capabilityResolution.styles,
    resolvedAssets: identity.capabilityResolution.assets,
    hostAdapterContracts: identity.capabilityResolution.hostAdapterContracts,
    appAccessItems: identity.appAccessItems,
    devPort: identity.devPort,
    appIdentity: buildIdentityMapping(identity, targetDir),
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions, identity.capabilityResolution),
    semantics: {
      role: 'app-scaffold-init-input',
      authority: 'app-tools-orchestration-input-not-platform-admission',
      nimicodingProjectionOwner: '@nimiplatform/nimi-coding',
    },
  };
}

function buildScaffoldIntentFile(identity, versions, targetDir = '') {
  return {
    path: SCAFFOLD_INTENT_PATH,
    content: jsonFile(buildScaffoldIntent(identity, versions, targetDir)),
    mutationClass: 'scaffold-managed glue',
    ownerKind: 'scaffold-state',
    ownerId: 'intent',
  };
}

function withFileOwner(files, ownerKind, ownerId) {
  return files.map((file) => ({
    ...file,
    ownerKind: file.ownerKind ?? ownerKind,
    ownerId: file.ownerId ?? ownerId,
  }));
}

function buildScaffoldFiles(identity, versions) {
  return [
    ...withFileOwner(
      buildStructuredFiles(identity, identity.profile, versions),
      'carrier',
      'structured',
    ),
    ...withFileOwner(
      buildDefaultStarterTemplateFiles(identity, identity.profile, versions),
      'carrier',
      'default-starter',
    ),
    ...withFileOwner(buildDefaultStarterFiles(identity), 'generated-glue', 'composition'),
    ...buildWorkbenchCoreFiles(identity, identity.profile, versions),
    ...buildCapabilitySliceFiles(identity, identity.profile, versions),
  ];
}

export function validateScaffoldFileOwnership(files) {
  const filesByPath = new Map();
  const filesByCollisionKey = new Map();
  for (const file of files) {
    const relativePath = String(file?.path || '');
    if (
      !relativePath
      || relativePath.startsWith('/')
      || relativePath.endsWith('/')
      || relativePath.includes('\\')
      || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || path.posix.normalize(relativePath) !== relativePath
    ) {
      throw new Error(`Scaffold file path is invalid: ${relativePath || 'missing'}`);
    }
    if (!file.ownerKind || !file.ownerId) {
      throw new Error(`Scaffold file ownership is missing: ${relativePath}`);
    }
    const collisionKey = relativePath.toLowerCase();
    const existing = filesByCollisionKey.get(collisionKey);
    if (existing) {
      throw new Error(
        `Scaffold file ownership collision: ${existing.path} and ${relativePath}: ${existing.ownerKind}/${existing.ownerId} and ${file.ownerKind}/${file.ownerId}`,
      );
    }
    filesByCollisionKey.set(collisionKey, file);
    filesByPath.set(relativePath, file);
  }
  for (const [relativePath, file] of filesByPath) {
    const segments = relativePath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index).join('/');
      const prefixFile = filesByCollisionKey.get(prefix.toLowerCase());
      if (prefixFile) {
        throw new Error(
          `Scaffold file/directory prefix collision: ${prefix}: ${prefixFile.ownerKind}/${prefixFile.ownerId} and ${file.ownerKind}/${file.ownerId}`,
        );
      }
    }
  }
  return filesByPath;
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
      '@nimiplatform/app-tools': versions.appToolsVersion,
      '@nimiplatform/nimi-coding': versions.nimicodingVersion,
      ...buildRuntimeDependencies(profile, versions, capabilityResolution),
      typescript: versions.typescriptVersion,
      vite: versions.viteVersion,
      tailwindcss: versions.tailwindcssVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@tailwindcss/vite': versions.tailwindcssViteVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
      electron: versions.electronVersion,
      esbuild: versions.esbuildVersion,
      yaml: versions.yamlVersion,
    },
    cargo: buildCargoDependencies(profile, versions, capabilityResolution),
    toolchain: {
      node: '>=20',
      pnpm: '>=9',
      rust: '>=1.80',
      tauri: '2',
    },
  };
}

function buildScaffoldLock(identity, versions, files, targetDir = '') {
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
    lockVersion: SCAFFOLD_LOCK_VERSION,
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
    directFeatures: identity.capabilityResolution.directFeatureIds,
    resolvedModules: identity.capabilityResolution.resolvedModuleIds,
    resolvedViews: identity.capabilityResolution.views,
    resolvedNavigation: identity.capabilityResolution.navigation,
    resolvedStyles: identity.capabilityResolution.styles,
    resolvedAssets: identity.capabilityResolution.assets,
    hostAdapterContracts: identity.capabilityResolution.hostAdapterContracts,
    appIdentity: buildIdentityMapping(identity, targetDir),
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

function buildAppScaffoldSnapshotWithResolver(
  { profile, versions, appId, appTitle, packageName, author, accentPack, features, targetDir = '' },
  featureResolver,
) {
  const identity = buildAppIdentity(
    profile,
    appId,
    appTitle,
    packageName,
    author,
    accentPack,
    features,
    featureResolver,
  );
  const createFiles = [
    ...buildScaffoldFiles(identity, versions),
    buildScaffoldIntentFile(identity, versions, targetDir),
  ];
  validateScaffoldFileOwnership(createFiles);
  const filesWithoutLock = [...createFiles];
  const lock = buildScaffoldLock(identity, versions, filesWithoutLock, targetDir);
  const initFiles = [
    {
      path: SCAFFOLD_LOCK_PATH,
      content: jsonFile(lock),
      mutationClass: 'scaffold-managed glue',
      ownerKind: 'scaffold-state',
      ownerId: 'lock',
    },
  ];
  const allFiles = [
    ...createFiles,
    ...initFiles,
  ];
  const filesByPath = validateScaffoldFileOwnership(allFiles);
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
    filesByPath,
  };
}

export function buildAppScaffoldSnapshot(input) {
  return buildAppScaffoldSnapshotWithResolver(input, resolveAppScaffoldFeatures);
}

export function buildAppScaffoldCandidateSnapshot(input) {
  return buildAppScaffoldSnapshotWithResolver(input, resolveAppScaffoldCandidateFeatures);
}

export function buildAppScaffoldSnapshotFromIntent({ intent, versions, targetDir = '', allowDerivedAppAccessDrift = false }) {
  if (intent?.intentVersion !== SCAFFOLD_INTENT_VERSION) {
    throw new Error(`Unsupported scaffold intent version: ${String(intent?.intentVersion || 'missing')}`);
  }
  if (intent?.scaffoldVersion !== SCAFFOLD_VERSION) {
    throw new Error(`Unsupported scaffold intent version source: ${String(intent?.scaffoldVersion || 'missing')}`);
  }
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(intent?.profile)) {
    throw new Error(`Unsupported scaffold profile: ${String(intent?.profile || 'missing')}`);
  }
  const canonicalTargetDir = targetDir || intent?.appIdentity?.targetDir || '';
  const snapshot = buildAppScaffoldSnapshotWithResolver({
    profile: intent.profile,
    versions,
    appId: intent.appId,
    appTitle: intent.appTitle,
    packageName: intent.packageName,
    author: intent.packageAuthor || '',
    accentPack: intent.accentPack || 'nimi-accent',
    features: intent.directFeatures,
    targetDir: canonicalTargetDir,
  }, resolveAppScaffoldIntentFeatures);
  const expectedIntent = JSON.parse(snapshot.filesByPath.get(SCAFFOLD_INTENT_PATH).content);
  const comparableIntent = allowDerivedAppAccessDrift
    ? { ...intent, appAccessItems: expectedIntent.appAccessItems }
    : intent;
  if (canonicalJson(comparableIntent) !== canonicalJson(expectedIntent)) {
    throw new Error('Scaffold intent does not match the current canonical resolved intent');
  }
  return snapshot;
}

function buildAppScaffoldCreatePlanWithResolver(
  { cwd, options = {}, versions, topology = null },
  featureResolver,
) {
  const resolvedInput = resolveAppScaffoldCreateInputWithResolver({ cwd, options }, featureResolver);
  const snapshot = buildAppScaffoldSnapshotWithResolver({
    profile: resolvedInput.profile,
    versions,
    appId: resolvedInput.appId,
    appTitle: resolvedInput.appTitle,
    packageName: resolvedInput.packageName,
    author: resolvedInput.author,
    accentPack: resolvedInput.accentPack,
    features: resolvedInput.directFeatures,
    targetDir: resolvedInput.targetDir,
  }, featureResolver);
  return Object.freeze({
    resolvedInput,
    snapshot,
    preview: Object.freeze({
      targetDir: resolvedInput.targetDir,
      profile: resolvedInput.profile,
      identity: snapshot.lock.appIdentity,
      directFeatures: snapshot.lock.directFeatures,
      resolvedModules: snapshot.lock.resolvedModules,
      resolvedViews: snapshot.lock.resolvedViews,
      resolvedNavigation: snapshot.lock.resolvedNavigation,
      resolvedStyles: snapshot.lock.resolvedStyles,
      resolvedAssets: snapshot.lock.resolvedAssets,
      hostAdapterContracts: snapshot.lock.hostAdapterContracts,
      npmDependencies: snapshot.lock.dependencyMatrix.npm,
      cargoDependencies: snapshot.lock.dependencyMatrix.cargo,
      appAccessItems: snapshot.lock.appAccessItems,
      topology,
    }),
  });
}

export function buildAppScaffoldCreatePlan(input) {
  return buildAppScaffoldCreatePlanWithResolver(input, resolveAppScaffoldFeatures);
}

export function buildAppScaffoldCandidateCreatePlan(input) {
  return buildAppScaffoldCreatePlanWithResolver(input, resolveAppScaffoldCandidateFeatures);
}

export function createAppScaffold(input) {
  const { cwd, options, versions, createFileTree, ensureDirEmptyOrMissing } = input;
  const plan = input.plan || buildAppScaffoldCreatePlan({ cwd, options, versions });
  const { targetDir, profile } = plan.resolvedInput;
  const { snapshot } = plan;
  ensureDirEmptyOrMissing(targetDir);
  // Resolution, source collection and every structured serialization complete
  // before a missing target directory is materialized.
  try {
    input.mkdirSync(targetDir, { recursive: true });
    createFileTree(targetDir, snapshot.createFiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown filesystem failure');
    throw new Error(`Scaffold materialization failed; inspect the exact residual target ${targetDir}: ${message}`);
  }
  const payload = {
    ok: true,
    command: 'create',
    dir: targetDir,
    profile,
    preview: plan.preview,
  };
  if (!options.silent) {
    process.stdout.write(`[nimi-app] created ${profile} app scaffold at ${targetDir}\n`);
    process.stdout.write('[nimi-app] next: pnpm install && pnpm run init\n');
  }
  return payload;
}

export function createAppScaffoldCandidate(input) {
  const plan = input.plan || buildAppScaffoldCandidateCreatePlan(input);
  return createAppScaffold({ ...input, plan });
}
