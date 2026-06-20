import path from 'node:path';
import { createHash } from 'node:crypto';
import { readAppSourceFile, resolveAppSource } from '../scripts/sync-app-source.mjs';

const DEFAULT_APP_ID = 'my-nimi-app';
const DEFAULT_APP_TITLE = 'My Nimi App';
export const SCAFFOLD_VERSION = '2026-05-29.app-source-snapshot';
export const SCAFFOLD_STATE_DIR = '.nimi/app-scaffold';
export const SCAFFOLD_INTENT_PATH = `${SCAFFOLD_STATE_DIR}/intent.json`;
export const SCAFFOLD_LOCK_PATH = `${SCAFFOLD_STATE_DIR}/lock.json`;
export const SCAFFOLD_SUBMISSION_PATH = '.nimi/admission/submission.yaml';
export const SCAFFOLD_BUILD_PROFILE_PATH = '.nimi/admission/build-profile.yaml';
export const SUPPORTED_APP_SCAFFOLD_PROFILES = ['standalone', 'workspace-app'];
const LOCKFILE_POLICY = 'author-install-generates-lockfile';
const GENERATED_GITIGNORE = [
  'node_modules/',
  'dist/',
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
const CANONICAL_PERMISSION_SCOPES = new Set('account.read account.session.read data.scope.read data.scope.write agent.identity.project agent.identity.bind ai.spend.meter ai.spend.delegate memory.read.bounded memory.write.admitted knowledge.read.bounded knowledge.write.admitted notification.send notification.subscribe file.read.scoped file.write.scoped device.use.scoped audit.read.scoped ai_profile.selection.consume'.split(' '));
const DEFAULT_PERMISSION_DECLARATIONS = Object.freeze([
  Object.freeze({
    scope: 'file.read.scoped',
    qualifier: 'app-local-drafts',
    purpose: 'Read drafts owned by this app during author testing.',
  }),
  Object.freeze({
    scope: 'file.write.scoped',
    qualifier: 'app-local-drafts',
    purpose: 'Store drafts owned by this app during author testing.',
  }),
]);

function normalizeScaffoldOmissions(input) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  for (const raw of source) {
    const value = String(raw || '').trim().replaceAll('\\', '/');
    if (!value || value.startsWith('/') || value.includes('..')) {
      throw new Error(`Invalid scaffold omission path: ${String(raw || 'missing')}`);
    }
    seen.add(value);
  }
  return normalizePathList(seen);
}

function wildcardPatternToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

export function isScaffoldOmittedPath(relativePath, omissions = [], matched = null) {
  for (const pattern of omissions || []) {
    if (relativePath === pattern || (pattern.includes('*') && wildcardPatternToRegExp(pattern).test(relativePath))) {
      matched?.add(pattern);
      return true;
    }
  }
  return false;
}

const CI_WORKFLOW = [
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

function normalizePermissionDeclarations(input) {
  const source = Array.isArray(input) && input.length > 0
    ? input
    : DEFAULT_PERMISSION_DECLARATIONS;
  const seen = new Set();
  return source.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid permission declaration ${index}`);
    }
    const scope = String(entry.scope || '').trim();
    const qualifier = String(entry.qualifier || '').trim();
    const purpose = String(entry.purpose || '').trim();
    if (!CANONICAL_PERMISSION_SCOPES.has(scope)) {
      throw new Error(`Invalid permission declaration scope: ${scope || 'missing'}`);
    }
    if (!purpose) {
      throw new Error(`Invalid permission declaration purpose for ${scope}`);
    }
    const key = `${scope}\u0000${qualifier}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate permission declaration: ${scope}${qualifier ? `:${qualifier}` : ''}`);
    }
    seen.add(key);
    return qualifier ? { scope, qualifier, purpose } : { scope, purpose };
  });
}

function buildAppIdentity(profile, appId, appTitle, packageName, author = '', accentPack = 'nimi-accent', permissionDeclarations = undefined, scaffoldOmissions = undefined) {
  const resolvedPackageName = packageName || packageSafeName(appId);
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
    permissionDeclarations: normalizePermissionDeclarations(permissionDeclarations),
    scaffoldOmissions: normalizeScaffoldOmissions(scaffoldOmissions),
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
    publishConfig: {
      access: 'public',
    },
    scripts: {
      dev: 'pnpm run dev:renderer',
      'dev:renderer': `vite --host 127.0.0.1 --port ${identity.devPort} --strictPort`,
      'dev:shell': 'tauri dev',
      init: 'nimi-app init',
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
      i18next: versions.i18nextVersion,
      'lucide-react': versions.lucideReactVersion,
      react: versions.reactVersion,
      'react-dom': versions.reactDomVersion,
      'react-i18next': versions.reactI18nextVersion,
    },
    devDependencies: {
      '@nimiplatform/app-tools': profile === 'workspace-app' ? 'workspace:*' : versions.appToolsVersion,
      '@nimiplatform/nimi-coding': profile === 'workspace-app' ? 'workspace:*' : versions.nimicodingVersion,
      '@tailwindcss/vite': versions.tailwindcssViteVersion,
      '@tauri-apps/cli': versions.tauriCliVersion,
      '@types/node': versions.nodeTypesVersion,
      '@types/react': versions.reactTypesVersion,
      '@types/react-dom': versions.reactDomTypesVersion,
      '@types/three': versions.threeTypesVersion,
      '@vitejs/plugin-react': versions.viteReactPluginVersion,
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

function renderPermissionDeclarations(declarations) {
  const lines = [];
  for (const declaration of declarations) {
    lines.push(`    - scope: ${declaration.scope}`);
    if (declaration.qualifier) {
      lines.push(`      qualifier: ${declaration.qualifier}`);
    }
    lines.push(`      purpose: ${declaration.purpose}`);
  }
  return lines;
}

function buildNimiAppManifest(identity) {
  return [
    `app_id: ${identity.appId}`,
    `display_name: ${identity.appTitle}`,
    `profile: ${identity.profile}`,
    'manifest_role: submitted-input',
    'permissions:',
    '  declared_nimi_api_scopes:',
    ...renderPermissionDeclarations(identity.permissionDeclarations),
    '',
  ].join('\n');
}

function applyProfileSeam(relativePath, content, profile, versions, manifest, identity) {
  if (relativePath === 'nimi.app.yaml') {
    return buildNimiAppManifest(identity);
  }
  if (relativePath === 'src-tauri/Cargo.toml') {
    const workspaceLine = 'nimi-shell-tauri = { path = "../../../kit/shell/tauri" }';
    return content.replace(workspaceLine, cargoShellDependencyLine(profile, versions));
  }
  return content;
}

function buildSnapshotFiles(identity, profile, versions) {
  const { baseDir, manifest } = loadAppSource();
  const target = targetIdentityMap(identity);
  const matchedOmissions = new Set();
  const files = manifest.files.filter((entry) => !isScaffoldOmittedPath(entry.path, identity.scaffoldOmissions, matchedOmissions));
  const unmatchedOmissions = identity.scaffoldOmissions.filter((pattern) => !matchedOmissions.has(pattern));
  if (unmatchedOmissions.length > 0) {
    throw new Error(`Scaffold omissions did not match reference app paths: ${unmatchedOmissions.join(', ')}`);
  }
  return files.map((entry) => {
    const raw = readAppSourceFile(baseDir, entry.path);
    const identityApplied = applyIdentityReplacement(raw, manifest, target);
    const content = applyProfileSeam(entry.path, identityApplied, profile, versions, manifest, identity);
    return {
      path: entry.path,
      content,
      mutationClass: entry.class,
    };
  });
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
  if (profile === 'workspace-app') {
    files.push({
      path: `apps/${identity.packageName}/spec/app-slice.md`,
      content: [
        `# ${identity.appId} App Slice`,
        '',
        'Workspace-app profile input under P-APP authority. This app-slice file is not public Nimi App admission and does not create ordinary-user visibility.',
        '',
      ].join('\n'),
      mutationClass: 'package-owned projection',
    });
  }
  return files;
}

function buildScaffoldIntent(identity, versions) {
  return {
    intentVersion: 1,
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
    permissionDeclarations: identity.permissionDeclarations,
    scaffoldOmissions: identity.scaffoldOmissions,
    devPort: identity.devPort,
    dependencyMatrix: buildDependencyMatrix(identity.profile, versions),
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

function buildScaffoldSubmissionFile(identity) {
  return {
    path: SCAFFOLD_SUBMISSION_PATH,
    content: [
      `app_id: ${identity.appId}`,
      `display_name: ${identity.appTitle}`,
      `profile: ${identity.profile}`,
      'submission_role: developer-submitted-input',
      'publish_readiness:',
      '  install_command: pnpm install',
      '  init_command: pnpm run init',
      '  dev_shell_command: pnpm dev:shell',
      '  build_command: pnpm run build',
      '  pack_command: pnpm run pack',
      'review_inputs:',
      '  manifest: nimi.app.yaml',
      `  build_profile: ${SCAFFOLD_BUILD_PROFILE_PATH}`,
      `  scaffold_lock: ${SCAFFOLD_LOCK_PATH}`,
      '  local_audit: pnpm run local-audit',
      'admission_truth: platform-owned-after-review',
      '',
    ].join('\n'),
    mutationClass: 'scaffold-managed glue',
  };
}

function buildScaffoldBuildProfileFile() {
  return {
    path: SCAFFOLD_BUILD_PROFILE_PATH,
    content: [
      'build_profile_ref: tauri-pnpm-vite',
      'toolchain_version: node>=20;pnpm>=9;rust>=1.80;tauri=2',
      'install_command: pnpm install',
      'init_command: pnpm run init',
      'build_command: pnpm run build',
      'output_path: src-tauri/target/release',
      'lockfile_path: pnpm-lock.yaml',
      `lockfile_policy: ${LOCKFILE_POLICY}`,
      'ci_install_command: pnpm install --no-frozen-lockfile',
      'profile_role: developer-workflow-input',
      '',
    ].join('\n'),
    mutationClass: 'scaffold-managed glue',
  };
}

function buildInitProjectionFiles(identity) {
  return [
    buildScaffoldSubmissionFile(identity),
    buildScaffoldBuildProfileFile(),
  ];
}

function buildScaffoldFiles(identity, versions) {
  return [
    ...buildStructuredFiles(identity, identity.profile, versions),
    ...buildSnapshotFiles(identity, identity.profile, versions),
  ];
}

function normalizePathList(paths) {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function hashScaffoldContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function buildDependencyMatrix(profile, versions) {
  return {
    npm: {
      '@nimiplatform/app-tools': profile === 'workspace-app' ? 'workspace:*' : versions.appToolsVersion,
      '@nimiplatform/nimi-coding': profile === 'workspace-app' ? 'workspace:*' : versions.nimicodingVersion,
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
      yaml: versions.yamlVersion,
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
    lockVersion: 1,
    scaffoldVersion: SCAFFOLD_VERSION,
    profile: identity.profile,
    appId: identity.appId,
    appTitle: identity.appTitle,
    packageName: identity.packageName,
    packageAuthor: identity.author || null,
    cargoPackageName: identity.cargoPackageName,
    tauriIdentifier: identity.tauriIdentifier,
    accentPack: identity.accentPack,
    permissionDeclarations: identity.permissionDeclarations,
    scaffoldOmissions: identity.scaffoldOmissions,
    appIdentity: {
      appId: identity.appId,
      appTitle: identity.appTitle,
      npmPackageName: identity.packageName,
      packageAuthor: identity.author || null,
      cargoPackageName: identity.cargoPackageName,
      tauriIdentifier: identity.tauriIdentifier,
      accentPack: identity.accentPack,
      permissionDeclarations: identity.permissionDeclarations,
      scaffoldOmissions: identity.scaffoldOmissions,
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
      initRole: 'developer-scaffold-initialization-after-install',
      nimicodingProjectionOwner: '@nimiplatform/nimi-coding',
      nimicodingApplyCommand: 'pnpm exec nimicoding sync --apply --json',
      nimicodingCheckCommand: 'pnpm exec nimicoding sync --check --json',
      doctorAndUpdateRole: 'developer-scaffold-check-only',
      publicAdmissionTruth: 'not-generated',
      installedAppUpdateTruth: 'not-generated',
      permissionGrantTruth: 'not-generated',
      lockfilePolicy: LOCKFILE_POLICY,
      ignoredVerificationArtifacts: ['dist/'],
    },
  };
}

export function buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author, accentPack, permissionDeclarations, scaffoldOmissions }) {
  const identity = buildAppIdentity(profile, appId, appTitle, packageName, author, accentPack, permissionDeclarations, scaffoldOmissions);
  const createFiles = [
    ...buildScaffoldFiles(identity, versions),
    buildScaffoldIntentFile(identity, versions),
  ];
  const initProjectionFiles = buildInitProjectionFiles(identity);
  const filesWithoutLock = [
    ...createFiles,
    ...initProjectionFiles,
  ];
  const lock = buildScaffoldLock(identity, versions, filesWithoutLock);
  const initFiles = [
    ...initProjectionFiles,
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
    files: allFiles,
    createFiles,
    initFiles,
    filesWithoutLock,
    lock,
    filesByPath: new Map(allFiles.map((file) => [file.path, file])),
  };
}

export function buildAppScaffoldSnapshotFromIntent({ intent, versions }) {
  if (intent?.intentVersion !== 1) {
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
    permissionDeclarations: intent.permissionDeclarations || intent.appIdentity?.permissionDeclarations,
    scaffoldOmissions: intent.scaffoldOmissions || intent.appIdentity?.scaffoldOmissions,
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
  const snapshot = buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author });
  createFileTree(targetDir, snapshot.createFiles);
  process.stdout.write(`[nimi-app] created ${profile} app scaffold at ${targetDir}\n`);
  process.stdout.write('[nimi-app] next: pnpm install && pnpm run init\n');
}
