import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_APP_ID = 'my-nimi-app';
const DEFAULT_APP_TITLE = 'My Nimi App';
export const SCAFFOLD_VERSION = '2026-05-24.wave-4-remediation-b';
export const SCAFFOLD_STATE_DIR = '.nimi/app-scaffold';
export const SCAFFOLD_INTENT_PATH = `${SCAFFOLD_STATE_DIR}/intent.json`;
export const SCAFFOLD_LOCK_PATH = `${SCAFFOLD_STATE_DIR}/lock.json`;
export const SCAFFOLD_SUBMISSION_PATH = '.nimi/admission/submission.yaml';
export const SCAFFOLD_BUILD_PROFILE_PATH = '.nimi/admission/build-profile.yaml';
export const SUPPORTED_APP_SCAFFOLD_PROFILES = ['standalone', 'workspace-app'];
const SCAFFOLD_LICENSE_YEAR = '2026';
const LOCKFILE_POLICY = 'author-install-generates-lockfile';
const TEMPLATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/app-scaffold');
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

function deriveScaffoldDevPort(appId) {
  let hash = 0;
  for (const char of String(appId || DEFAULT_APP_ID)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100;
  }
  return 1430 + hash;
}

function resolveProfile(options) {
  const profile = String(options.profile || '').trim() || 'standalone';
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)) {
    throw new Error(`Unsupported app scaffold profile: ${profile}`);
  }
  return profile;
}

function buildPackageJson(profile, versions, identity) {
  const devPort = deriveScaffoldDevPort(identity.appId);
  const packageJson = {
    name: identity.packageName,
    private: false,
    type: 'module',
    publishConfig: {
      access: 'public',
    },
    scripts: {
      dev: 'pnpm run dev:renderer',
      'dev:renderer': `vite --host 127.0.0.1 --port ${devPort} --strictPort`,
      'dev:shell': 'node scripts/dev-shell.mjs',
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
    },
  };
  if (identity.author) {
    packageJson.author = identity.author;
  }
  return packageJson;
}

function isNimiTesterIdentity(identity) {
  return identity.appId === 'nimi.tester';
}

function shellDependencyForProfile(profile, versions) {
  if (profile === 'workspace-app') {
    return '{ path = "../../../kit/shell/tauri" }';
  }
  return JSON.stringify(versions.nimiShellTauriVersion);
}

function buildTemplateContext(identity, versions) {
  const isNimiTester = isNimiTesterIdentity(identity);
  const devPort = deriveScaffoldDevPort(identity.appId);
  const appOwnedProductCodeYaml = isNimiTester
    ? [
        '    - src/shell/routes/product-area.tsx',
        '    - src/tester/**',
        '    - src-tauri/src/tester_storage.rs',
        '    - src-tauri/src/world_tour.rs',
        '    - test/tester-contract.test.mjs',
        '    - test/world-tour-contract.test.mjs',
      ].join('\n')
    : '    - src/shell/routes/product-area.tsx';
  return {
    APP_ID: identity.appId,
    APP_TITLE: identity.appTitle,
    PROFILE: identity.profile,
    PACKAGE_NAME: identity.packageName,
    CARGO_PACKAGE_NAME: identity.cargoPackageName,
    TAURI_IDENTIFIER: identity.tauriIdentifier,
    PACKAGE_AUTHOR_LINE: identity.author ? 'package_author: ' + identity.author + '\n' : '',
    DEV_PORT: String(devPort),
    RUNTIME_ACCOUNT_LOGIN_ENABLED: isNimiTesterIdentity(identity) ? 'true' : 'false',
    NIMI_SHELL_TAURI_DEPENDENCY: shellDependencyForProfile(identity.profile, versions),
    APP_OWNED_AREA_SENTENCE: isNimiTester
      ? 'The app-owned area is `src/shell/routes/product-area.tsx`, `src/tester/**`, app-owned tester Tauri modules under `src-tauri/src/{tester_storage.rs,world_tour.rs}`, and tester contract tests.'
      : 'The app-owned area is `src/shell/routes/product-area.tsx` unless a later scaffold update expands it.',
    APP_OWNED_PRODUCT_CODE_YAML: appOwnedProductCodeYaml,
    SCAFFOLD_LICENSE_YEAR,
  };
}

function renderTemplateString(template, context, templatePath) {
  const rendered = String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.hasOwn(context, key)) {
      throw new Error('Unknown scaffold template token ' + match + ' in ' + templatePath);
    }
    return context[key];
  });
  if (/\{\{[A-Z0-9_]+\}\}/.test(rendered)) {
    throw new Error('Unresolved scaffold template token in ' + templatePath);
  }
  return rendered;
}

function renderTemplatePath(relativePath, context) {
  const withoutExtension = relativePath.endsWith('.tmpl') ? relativePath.slice(0, -'.tmpl'.length) : relativePath;
  return renderTemplateString(withoutExtension, context, relativePath);
}

function listTemplateFiles(templateDir) {
  const entries = readdirSync(templateDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(templateDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTemplateFiles(entryPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith('.tmpl')) {
      throw new Error('Unsupported scaffold template file without .tmpl suffix: ' + entryPath);
    }
    files.push(entryPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function buildFilesFromTemplateDir(templateDir, context) {
  return listTemplateFiles(templateDir).map((templatePath) => {
    const relativeTemplatePath = path.relative(templateDir, templatePath).split(path.sep).join('/');
    return {
      path: renderTemplatePath(relativeTemplatePath, context),
      content: renderTemplateString(readFileSync(templatePath, 'utf8'), context, templatePath),
    };
  });
}

function buildTemplateFiles(identity, versions) {
  const context = buildTemplateContext(identity, versions);
  const productTemplate = isNimiTesterIdentity(identity) ? 'nimi-tester' : 'default';
  const templateDirs = [
    path.join(TEMPLATE_ROOT, 'common'),
    path.join(TEMPLATE_ROOT, 'product', productTemplate),
  ];
  if (identity.profile === 'workspace-app') {
    templateDirs.push(path.join(TEMPLATE_ROOT, 'workspace-app'));
  }
  const filesByPath = new Map();
  for (const templateDir of templateDirs) {
    for (const file of buildFilesFromTemplateDir(templateDir, context)) {
      filesByPath.set(file.path, file);
    }
  }
  return [...filesByPath.values()];
}

function buildStructuredFiles(identity, versions) {
  return [
    {
      path: 'package.json',
      content: jsonFile(buildPackageJson(identity.profile, versions, identity)),
    },
    {
      path: 'src-tauri/icons/icon.png',
      content: MINIMAL_TAURI_ICON_PNG,
    },
  ];
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
    devPort: deriveScaffoldDevPort(identity.appId),
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
    ...buildStructuredFiles(identity, versions),
    ...buildTemplateFiles(identity, versions),
  ];
}

function normalizePathList(paths) {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function classifyScaffoldFile(filePath, identity) {
  if (filePath === 'src/shell/routes/product-area.tsx') {
    return 'app-owned product code';
  }
  if (isNimiTesterIdentity(identity) && (
    filePath.startsWith('src/tester/')
    || filePath === 'src-tauri/src/tester_storage.rs'
    || filePath === 'src-tauri/src/world_tour.rs'
    || filePath === 'test/tester-contract.test.mjs'
    || filePath === 'test/world-tour-contract.test.mjs'
  )) {
    return 'app-owned product code';
  }
  if (
    filePath.startsWith('.nimi/config/')
    || filePath.startsWith('.nimi/contracts/')
    || filePath.startsWith('.nimi/methodology/')
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
    const mutationClass = classifyScaffoldFile(file.path, identity);
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

export function buildAppScaffoldSnapshot({ profile, versions, appId, appTitle, packageName, author }) {
  const identity = buildAppIdentity(profile, appId, appTitle, packageName, author);
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
