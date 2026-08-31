import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  buildAppScaffoldSnapshotFromIntent,
  hashScaffoldContent,
  SCAFFOLD_INTENT_PATH,
  SCAFFOLD_LOCK_VERSION,
  SCAFFOLD_LOCK_PATH,
  SCAFFOLD_VERSION,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
} from './app-scaffold.mjs';
import { assertManifestAppAccessDeclaration } from './app-access-declaration.mjs';
import { validateSimulatorAppSourceWithCanonicalKitExports } from './simulator-conformance.mjs';

const SCAN_EXCLUDED_DIRS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'docs',
  'node_modules',
  'target',
  '.tmp',
]);
const SCAN_EXCLUDED_FILES = new Set([
  'Cargo.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.rs',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const PROVIDER_MODEL_HARDCODING_PROVIDERS = Object.freeze([
  'openai',
  'anthropic',
  'gemini',
  'mistral',
  'llama',
  'deepseek',
  'qwen',
  'cohere',
  'groq',
  'xai',
  'grok',
  'perplexity',
  'ollama',
]);
const PROVIDER_MODEL_HARDCODING_MODEL_FAMILIES = Object.freeze([
  String.raw`claude(?:-[a-z0-9][a-z0-9._-]*)+`,
  String.raw`gemini(?:[/-][a-z0-9][a-z0-9._-]*)+`,
  String.raw`gpt-(?:[a-z0-9][a-z0-9._-]*)?`,
  String.raw`mistral(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`llama(?:[-.][a-z0-9][a-z0-9._-]*|[0-9][a-z0-9._-]*)?`,
  String.raw`deepseek(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`qwen(?:[-.][a-z0-9][a-z0-9._-]*|[0-9][a-z0-9._-]*)?`,
  String.raw`cohere(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`groq(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`xai(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`grok(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`perplexity(?:-[a-z0-9][a-z0-9._-]*)*`,
  String.raw`ollama(?:-[a-z0-9][a-z0-9._-]*)*`,
]);
const LOCAL_DEVELOPMENT_BYPASS_LABELS = new Set([
  'generic platform auth helper in scaffold',
  'Realm login bypass endpoint',
  'Realm refresh bypass endpoint',
  'Realm permission grant REST bypass endpoint',
  'Realm raw request bypass',
  'Realm API path literal bypass',
  'Realm API url literal bypass',
  'Realm API fetch bypass',
  'OpenAI-compatible Runtime REST endpoint assumption',
  'app-owned session store',
  'app-owned refresh token provider',
  'app-owned protected Runtime gRPC client',
  'app-owned Runtime endpoint custody',
  'renderer or app storage of protected material',
  'environment custody of protected material',
  'renderer launch binding custody',
  'installed-app developer registration bypass',
  'Desktop private import',
  'Runtime private import',
  'generated private Runtime client',
]);

function resolveTargetDir(cwd, options = {}) {
  return path.resolve(cwd, String(options.dir || '').trim() || '.');
}

function readJsonFile(filePath, label = 'JSON file') {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${filePath}: ${message}`);
  }
}

function readLock(targetDir) {
  const lockPath = path.join(targetDir, SCAFFOLD_LOCK_PATH);
  if (!existsSync(lockPath)) {
    throw new Error(`Missing initialized scaffold lock: ${SCAFFOLD_LOCK_PATH}. Run pnpm install, then pnpm run init.`);
  }
  return readJsonFile(lockPath, 'scaffold lock');
}

function readIntent(targetDir) {
  const intentPath = path.join(targetDir, SCAFFOLD_INTENT_PATH);
  if (!existsSync(intentPath)) {
    throw new Error(`Missing scaffold init intent: ${SCAFFOLD_INTENT_PATH}`);
  }
  return readJsonFile(intentPath, 'scaffold init intent');
}

function assertSupportedLock(lock) {
  if (lock?.lockVersion !== SCAFFOLD_LOCK_VERSION) {
    throw new Error(`Unsupported scaffold lock version: ${String(lock?.lockVersion || 'missing')}`);
  }
  if (lock?.scaffoldVersion !== SCAFFOLD_VERSION) {
    throw new Error(`Unsupported scaffold version: ${String(lock?.scaffoldVersion || 'missing')}`);
  }
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(lock?.profile)) {
    throw new Error(`Unsupported scaffold profile: ${String(lock?.profile || 'missing')}`);
  }
  if (!lock.appId || !lock.appTitle || !lock.version) {
    throw new Error('Scaffold lock missing app identity');
  }
}

function sortedObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortedObject);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortedObject(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(sortedObject(value));
}

function assertSameJson(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label} does not match current scaffold generator`);
  }
}

function expectedSnapshotFromLock(lock, versions, intent, targetDir, options = {}) {
  assertSupportedLock(lock);
  if (!intent) {
    throw new Error(`Missing scaffold init intent: ${SCAFFOLD_INTENT_PATH}`);
  }
  const snapshot = buildAppScaffoldSnapshotFromIntent({
    intent,
    versions,
    targetDir,
    allowDerivedAppAccessDrift: options.allowDerivedAppAccessDrift === true,
  });
  if (stableStringify(intent.directFeatures) !== stableStringify(lock.directFeatures)) {
    throw new Error('Scaffold feature selection is immutable; create a fresh scaffold for a different feature closure');
  }
  return snapshot;
}

function readContentForHash(filePath) {
  return readFileSync(filePath);
}

function ensureLockMatchesCurrentGenerator(lock, snapshot) {
  assertSameJson(lock.scaffoldVersion, snapshot.lock.scaffoldVersion, 'Scaffold version');
  assertSameJson(lock.appIdentity, snapshot.lock.appIdentity, 'App identity');
  assertSameJson(lock.version, snapshot.lock.version, 'App version');
  assertSameJson(lock.packageName, snapshot.lock.packageName, 'Package name');
  assertSameJson(lock.packageAuthor, snapshot.lock.packageAuthor, 'Package author');
  assertSameJson(lock.cargoPackageName, snapshot.lock.cargoPackageName, 'Cargo package name');
  assertSameJson(lock.tauriIdentifier, snapshot.lock.tauriIdentifier, 'Tauri identifier');
  assertSameJson(lock.accentPack, snapshot.lock.accentPack, 'Accent pack');
  assertSameJson(lock.features, snapshot.lock.features, 'Scaffold features');
  assertSameJson(lock.directFeatures, snapshot.lock.directFeatures, 'Direct scaffold features');
  assertSameJson(lock.resolvedModules, snapshot.lock.resolvedModules, 'Resolved scaffold modules');
  assertSameJson(lock.resolvedViews, snapshot.lock.resolvedViews, 'Resolved scaffold views');
  assertSameJson(lock.resolvedNavigation, snapshot.lock.resolvedNavigation, 'Resolved scaffold navigation');
  assertSameJson(lock.resolvedStyles, snapshot.lock.resolvedStyles, 'Resolved scaffold styles');
  assertSameJson(lock.resolvedAssets, snapshot.lock.resolvedAssets, 'Resolved scaffold assets');
  assertSameJson(lock.hostAdapterContracts, snapshot.lock.hostAdapterContracts, 'Scaffold host adapter contracts');
  assertSameJson(lock.appAccessItems, snapshot.lock.appAccessItems, 'App access items');
  assertSameJson(lock.capabilityContractRefs, snapshot.lock.capabilityContractRefs, 'Capability contract refs');
  assertSameJson(lock.requiredStandardizedFeatureRefs, snapshot.lock.requiredStandardizedFeatureRefs, 'Required standardized feature refs');
  assertSameJson(lock.managedFileTaxonomy, snapshot.lock.managedFileTaxonomy, 'Managed file taxonomy');
  assertSameJson(lock.dependencyMatrix, snapshot.lock.dependencyMatrix, 'Dependency matrix');
  assertSameJson(lock.managedFileHashes, snapshot.lock.managedFileHashes, 'Managed file hashes');
  assertSameJson(
    projectHashClasses(lock.appOwnedInitialHashes),
    projectHashClasses(snapshot.lock.appOwnedInitialHashes),
    'App-owned taxonomy',
  );
  assertSameJson(lock.semantics, snapshot.lock.semantics, 'Scaffold semantics');
}

function projectHashClasses(entries) {
  return Object.fromEntries(
    Object.entries(entries || {}).map(([relativePath, entry]) => [
      relativePath,
      { class: entry?.class || '' },
    ]),
  );
}

function collectTextFiles(rootDir) {
  const results = [];
  const walk = (currentDir) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (SCAN_EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (SCAN_EXCLUDED_FILES.has(entry.name)) {
        continue;
      }
      if (
        relativePath.startsWith('.nimi/config/')
        || relativePath.startsWith('.nimi/contracts/')
        || relativePath.startsWith('.nimi/methodology/')
        || relativePath.startsWith('.nimi/spec/')
        || relativePath.startsWith('.nimi/local/')
        || relativePath.startsWith('.nimi/cache/')
      ) {
        continue;
      }
      const stat = statSync(fullPath);
      if (stat.size > 1024 * 1024) {
        continue;
      }
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }
      results.push(fullPath);
    }
  };
  walk(rootDir);
  return results;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildProviderModelHardcodingPattern() {
  const providerAlternation = PROVIDER_MODEL_HARDCODING_PROVIDERS.map(escapeRegExp).join('|');
  const modelAlternation = PROVIDER_MODEL_HARDCODING_MODEL_FAMILIES.join('|');
  const providerOrModelAlternation = `(?:${providerAlternation}|${modelAlternation})`;
  const quote = `['"\`]`;
  const tokenStart = String.raw`(?:^|[^A-Za-z0-9_@./-])`;
  const tokenEnd = String.raw`(?=$|[^A-Za-z0-9_@./-])`;
  const keyedLiteral = String.raw`\b(?:provider|providerId|providerName|model|modelId|modelName|defaultModel|selectedModel)\b\s*[:=]\s*${quote}${providerOrModelAlternation}${quote}`;
  const slashQualifiedLiteral = `${tokenStart}(?:${providerAlternation})/(?:${modelAlternation}|[a-z0-9][a-z0-9._-]*)${tokenEnd}`;
  const bareProviderOrModelLiteral = `${tokenStart}${providerOrModelAlternation}${tokenEnd}`;
  return new RegExp(`(?:${keyedLiteral}|${slashQualifiedLiteral}|${bareProviderOrModelLiteral})`, 'i');
}

function buildForbiddenPatterns() {
  const runtimeBridgeName = ['runtime', 'bridge', 'plugin'].join('_');
  const modelTestImport = ['kit', 'features', 'model-test'].join('/');
  return [
    ['generic platform auth helper in scaffold', /createPlatformClient\s*\(/],
    ['first-party helper in third-party scaffold', /createLocalFirstPartyRuntimePlatformClient/],
    ['Realm login bypass endpoint', /\/api\/auth\/login/],
    ['Realm refresh bypass endpoint', /\/api\/auth\/refresh/],
    ['Realm permission grant REST bypass endpoint', /\/api\/human\/me\/permission-grants/],
    ['Realm raw request bypass', /\b(?:raw|unsafeRaw)\.request(?:<[\s\S]*?>)?\s*\(/],
    ['Realm API path literal bypass', /\bpath\s*:\s*['"`]\/api\//],
    ['Realm API url literal bypass', /\burl\s*:\s*['"`]\/api\//],
    ['Realm API fetch bypass', /\bfetch\s*\(\s*['"`]\/api\//],
    ['direct Realm permission grant module access', /\.permissionGrants\./],
    ['direct Realm permission grant method', /\b(?:listMyAppPermissionGrants|getMyAppPermissionGrant(?:Status|Projection)?|requestMyAppPermissionGrant|revokeMyAppPermissionGrant)\s*\(/],
    ['OpenAI-compatible Runtime REST endpoint assumption', /\/v1\/(?:chat\/completions|responses|embeddings|audio|images|models)\b/],
    ['app-owned session store', /sessionStore/],
    ['app-owned refresh token provider', /refreshTokenProvider/],
    ['app-owned protected Runtime gRPC client', /@grpc\/grpc-js|\bgrpc\.credentials\.createInsecure\s*\(/],
    ['app-owned Runtime endpoint custody', /\b(?:NIMI_RUNTIME_ENDPOINT|runtimeEndpoint)\b/],
    ['renderer or app storage of protected material', /\b(?:localStorage|sessionStorage)\.setItem\s*\([^\n]{0,160}(?:access[_-]?token|refresh[_-]?token|launch[_-]?ticket|protected[_-]?session|credential)/i],
    ['environment custody of protected material', /\bNIMI_[A-Z0-9_]*(?:TOKEN|TICKET|SESSION|CREDENTIAL)(?:_ID|_SECRET)?\b/],
    ['raw bearer token custody wording', /raw JWT/i],
    ['model-test import', new RegExp(modelTestImport.replace('/', '\\/'))],
    ['stale Runtime shell API', new RegExp(runtimeBridgeName)],
    ['provider/model hardcoding', buildProviderModelHardcodingPattern()],
    ['external principal installed-app posture', /\bACCOUNT_CALLER_MODE_EXTERNAL_PRINCIPAL\b/],
    ['renderer launch binding custody', /\b(?:launchNonce|releaseDescriptorRef|launchBinding)\b/],
    ['installed-app developer registration bypass', /(?:developerRegistration\s*:\s*true[\s\S]{0,160}third-party-nimi-app|third-party-nimi-app[\s\S]{0,160}developerRegistration\s*:\s*true)/],
    ['Desktop private import', /\bfrom\s+['"`][^'"`]*apps\/desktop\//],
    ['Runtime private import', /\bfrom\s+['"`][^'"`]*runtime\/internal\//],
    ['generated private Runtime client', /\bfrom\s+['"`][^'"`]*(?:@nimiplatform\/runtime\/generated\/private-client|runtime\/generated\/private|generated\/private-client)/],
    ['forbidden installed-app shell capability', /\b(?:auth\.session(?:Load|Save|Clear)|local-agent\.runtimeTrustedCaller|platform-projection\.get|tauri-only\.commands)\b/],
  ];
}

function scanForbiddenPatterns(targetDir, profile, selectedLabels = null) {
  const findings = [];
  const patterns = buildForbiddenPatterns();
  const testFileAllowedLabels = new Set([
    'renderer launch binding custody',
    'installed-app developer registration bypass',
    'forbidden installed-app shell capability',
    'Desktop private import',
    'Runtime private import',
    'generated private Runtime client',
    'external principal installed-app posture',
    'app-owned protected Runtime gRPC client',
    'app-owned Runtime endpoint custody',
    'renderer or app storage of protected material',
    'environment custody of protected material',
  ]);
  for (const filePath of collectTextFiles(targetDir)) {
    const relativePath = path.relative(targetDir, filePath).split(path.sep).join('/');
    const text = readFileSync(filePath, 'utf8');
    const isTestFile = relativePath.startsWith('test/') || /(?:^|\/)\w[^/]*\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(relativePath);
    for (const [label, pattern] of patterns) {
      if (selectedLabels && !selectedLabels.has(label)) {
        continue;
      }
      if (selectedLabels && isTestFile) {
        continue;
      }
      // Test files reference provider/model names to assert behavior (including
      // negative assertions that forbid hardcoding); only product/glue source is
      // product truth, so the hardcoding pattern is scoped out of tests.
      if (label === 'provider/model hardcoding' && isTestFile) {
        continue;
      }
      if (isTestFile && testFileAllowedLabels.has(label)) {
        continue;
      }
      if (pattern.test(text)) {
        findings.push(`${relativePath}: ${label}`);
      }
    }
  }
  return findings;
}

function assertRequiredSupportFiles(targetDir, snapshot) {
  const missing = [];
  for (const file of snapshot.files) {
    if (!snapshot.lock.managedFileHashes[file.path]) {
      continue;
    }
    if (!existsSync(path.join(targetDir, file.path))) {
      missing.push(file.path);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required scaffold support files: ${missing.join(', ')}`);
  }

  const tauriConfig = JSON.parse(readFileSync(path.join(targetDir, 'src-tauri/tauri.conf.json'), 'utf8'));
  const icons = tauriConfig?.bundle?.icon;
  if (!Array.isArray(icons) || icons.join(',') !== 'icons/icon.png,icons/icon.ico') {
    throw new Error('Tauri icon support drift: bundle.icon must be ["icons/icon.png","icons/icon.ico"]');
  }
  const icon = readFileSync(path.join(targetDir, 'src-tauri/icons/icon.png'));
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (icon.length !== 68 || pngSignature.some((value, index) => icon[index] !== value)) {
    throw new Error('Tauri icon support drift: src-tauri/icons/icon.png is not the scaffold PNG');
  }
  const ico = readFileSync(path.join(targetDir, 'src-tauri/icons/icon.ico'));
  const icoHeader = [0x00, 0x00, 0x01, 0x00, 0x01, 0x00];
  if (
    ico.length !== 90
    || icoHeader.some((value, index) => ico[index] !== value)
    || pngSignature.some((value, index) => ico[index + 22] !== value)
  ) {
    throw new Error('Tauri icon support drift: src-tauri/icons/icon.ico is not the scaffold ICO');
  }
}

function assertProjectConfiguration(targetDir, parsedManifest = null) {
  const manifestPath = path.join(targetDir, 'nimi.app.yaml');
  const manifest = readFileSync(manifestPath, 'utf8');
  assertManifestAppAccessDeclaration(manifest, manifestPath);
  let document = parsedManifest;
  if (!document) {
    try {
      document = parseYaml(manifest);
    } catch (error) {
      throw new Error(`Submitted manifest YAML cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const rendererOrigin = assertElectronLocalDevelopmentManifest(document);
  assertOfficialDevelopmentEntrypoints(targetDir, rendererOrigin);
}

function assertElectronLocalDevelopmentManifest(document) {
  const rendererOrigin = document?.local_development?.electron?.renderer_origin;
  if (typeof rendererOrigin !== 'string' || rendererOrigin.trim() !== rendererOrigin) {
    throw new Error('nimi.app.yaml must declare local_development.electron.renderer_origin');
  }
  let parsed;
  try {
    parsed = new URL(rendererOrigin);
  } catch {
    throw new Error('nimi.app.yaml local_development.electron.renderer_origin must be a canonical loopback origin');
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || rendererOrigin !== parsed.origin
  ) {
    throw new Error('nimi.app.yaml local_development.electron.renderer_origin must be a canonical 127.0.0.1 origin');
  }
  return parsed.origin;
}

function assertOfficialDevelopmentEntrypoints(targetDir, rendererOrigin) {
  const packageJson = readJsonFile(path.join(targetDir, 'package.json'), 'package.json');
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw new Error('package.json scripts are required');
  }
  const rendererPort = new URL(rendererOrigin).port;
  const required = {
    dev: 'nimi-app dev --shell electron',
    'dev:shell': 'nimi-app dev',
    'dev:renderer': `vite --host 127.0.0.1 --port ${rendererPort} --strictPort`,
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) {
      throw new Error(`package.json ${name} must use the official local-development launcher: ${command}`);
    }
  }
  if (
    typeof scripts['build:electron'] !== 'string'
    || scripts['build:electron'].trim() !== scripts['build:electron']
    || scripts['build:electron'].length === 0
  ) {
    throw new Error('package.json build:electron must build the Desktop-supervised Electron host');
  }
  for (const [name, value] of Object.entries(scripts)) {
    const command = typeof value === 'string' ? value.trim() : '';
    if (/--shell\s+tauri(?:\s|$)/i.test(command)) {
      throw new Error(`package.json ${name} selects the retired Tauri local-development carrier`);
    }
    if (/(?:^|\s)(?:(?:pnpm\s+(?:exec\s+)?)|(?:npx\s+))?tauri\s+dev(?:\s|$)/i.test(command)) {
      throw new Error(`package.json ${name} bypasses the Desktop-owned Electron development supervisor`);
    }
    if (/^(?:(?:pnpm\s+(?:exec\s+)?)|(?:npx\s+))?electron(?:\.cmd)?(?:\s|$)/i.test(command)) {
      throw new Error(`package.json ${name} bypasses the Desktop-owned Electron development supervisor`);
    }
  }
}

function assertNimicodingProjectionCurrent(targetDir, runners) {
  if (!runners?.runNimicodingSync) {
    throw new Error('Missing nimicoding sync runner');
  }
  const result = runners.runNimicodingSync(targetDir, 'check');
  if (result && result.ok === false) {
    throw new Error('nimicoding package-owned projection check failed');
  }
}

function assertManagedFilesCurrent(targetDir, lock) {
  const drift = [];
  for (const [relativePath, entry] of Object.entries(lock.managedFileHashes || {})) {
    const absolutePath = path.join(targetDir, relativePath);
    if (!existsSync(absolutePath)) {
      drift.push(`${relativePath}: missing`);
      continue;
    }
    const currentHash = hashScaffoldContent(readContentForHash(absolutePath));
    if (currentHash !== entry.sha256) {
      drift.push(`${relativePath}: sha256 drift`);
    }
  }
  if (drift.length > 0) {
    throw new Error(`Managed scaffold drift detected: ${drift.join('; ')}`);
  }
}

function validateAppProjectState(targetDir, versions, runners = {}) {
  if (!existsSync(path.join(targetDir, SCAFFOLD_LOCK_PATH))) {
    if (existsSync(path.join(targetDir, SCAFFOLD_INTENT_PATH))) {
      readLock(targetDir);
    }
    return validateExistingSubmittedApp(targetDir);
  }
  const lock = readLock(targetDir);
  const intent = readIntent(targetDir);
  const snapshot = expectedSnapshotFromLock(lock, versions, intent, targetDir);
  ensureLockMatchesCurrentGenerator(lock, snapshot);
  assertRequiredSupportFiles(targetDir, snapshot);
  assertProjectConfiguration(targetDir);
  assertManagedFilesCurrent(targetDir, lock);
  assertNimicodingProjectionCurrent(targetDir, runners);
  const forbiddenFindings = scanForbiddenPatterns(targetDir, lock.profile);
  if (forbiddenFindings.length > 0) {
    throw new Error(`Forbidden scaffold remnants detected: ${forbiddenFindings.join('; ')}`);
  }
  return {
    targetDir,
    lock,
    snapshot,
  };
}

function validateExistingSubmittedApp(targetDir) {
  const manifestPath = path.join(targetDir, 'nimi.app.yaml');
  if (!existsSync(manifestPath)) {
    throw new Error('Existing submitted app requires nimi.app.yaml');
  }
  const manifest = readFileSync(manifestPath, 'utf8');
  let parsed;
  try {
    parsed = parseYaml(manifest);
  } catch (error) {
    throw new Error(`Submitted manifest YAML cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const appId = typeof parsed?.app_id === 'string' ? parsed.app_id.trim() : '';
  const profile = typeof parsed?.profile === 'string' ? parsed.profile.trim() : '';
  if (!appId || appId !== parsed?.app_id || !SUPPORTED_APP_SCAFFOLD_PROFILES.includes(profile)) {
    throw new Error('Existing submitted app requires canonical app_id and supported profile');
  }
  if (parsed?.manifest_role !== 'submitted-input') {
    throw new Error('Submitted manifest marker missing');
  }
  assertProjectConfiguration(targetDir, parsed);
  const forbiddenFindings = scanForbiddenPatterns(targetDir, profile, LOCAL_DEVELOPMENT_BYPASS_LABELS);
  if (forbiddenFindings.length > 0) {
    throw new Error(`Forbidden local-development bypasses detected: ${forbiddenFindings.join('; ')}`);
  }
  return {
    targetDir,
    managed: false,
    appId,
    profile,
    checkedFiles: collectTextFiles(targetDir).length,
  };
}

export function initApp(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const intent = readIntent(targetDir);
  const snapshot = buildAppScaffoldSnapshotFromIntent({ intent, versions, targetDir });
  if (!runners?.runNimicodingSync) {
    throw new Error('Missing nimicoding sync runner');
  }
  const nimicoding = runners.runNimicodingSync(targetDir, 'apply');
  for (const file of snapshot.initFiles) {
    writeScaffoldFile(targetDir, file);
  }
  validateAppProjectState(targetDir, versions, runners);
  const payload = {
    ok: true,
    command: 'init',
    dir: targetDir,
    scaffoldVersion: snapshot.lock.scaffoldVersion,
    profile: snapshot.lock.profile,
    appId: snapshot.lock.appId,
    features: snapshot.lock.features,
    initializedFiles: snapshot.initFiles.length,
    nimicodingSync: nimicoding?.summary || null,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`[nimi-app] init completed for ${targetDir}\n`);
  }
  return payload;
}

export function validateAppProject(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  if (options.conformance) {
    if (options.conformance !== 'simulator') {
      throw new Error(`Unsupported conformance target: ${options.conformance}`);
    }
    if (options.json) {
      throw new Error('--json is not supported for Simulator source validation');
    }
    return validateSimulatorAppSourceWithCanonicalKitExports(targetDir).then((result) => {
      process.stdout.write(`[nimi-app] Simulator source validation passed for ${targetDir}\n`);
      return result;
    });
  }
  const result = validateAppProjectState(targetDir, versions, runners);
  const payload = {
    ok: true,
    command: 'check',
    dir: targetDir,
    scaffoldVersion: result.lock?.scaffoldVersion ?? null,
    profile: result.lock?.profile ?? result.profile,
    appId: result.lock?.appId ?? result.appId,
    features: result.lock?.features ?? [],
    checkedManagedFiles: result.lock ? Object.keys(result.lock.managedFileHashes || {}).length : 0,
    checkedExistingFiles: result.managed === false ? result.checkedFiles : 0,
  };
  if (options.silent) {
    return payload;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`[nimi-app] check passed for ${targetDir}\n`);
  }
  return payload;
}

function collectExpectedClasses(snapshot) {
  const entries = new Map();
  for (const [relativePath, entry] of Object.entries(snapshot.lock.managedFileHashes)) {
    entries.set(relativePath, { class: entry.class, owner: 'managed' });
  }
  for (const [relativePath, entry] of Object.entries(snapshot.lock.appOwnedInitialHashes)) {
    entries.set(relativePath, { class: entry.class, owner: 'app-owned' });
  }
  return entries;
}

function assertNoClassificationConflict(lock, snapshot) {
  const currentClasses = collectExpectedClasses(snapshot);
  for (const [relativePath, entry] of Object.entries(lock.managedFileHashes || {})) {
    const current = currentClasses.get(relativePath);
    if (current?.owner === 'managed' && current.class === entry.class) {
      continue;
    }
    throw new Error(`Scaffold classification conflict: ${relativePath}`);
  }
  for (const [relativePath, entry] of Object.entries(lock.appOwnedInitialHashes || {})) {
    const current = currentClasses.get(relativePath);
    if (current?.owner === 'app-owned' && current.class === entry.class) {
      continue;
    }
    throw new Error(`Scaffold classification conflict: ${relativePath}`);
  }
}

function writeScaffoldFile(targetDir, file) {
  const targetPath = path.join(targetDir, file.path);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, file.content);
}

export function syncManagedApp(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const lock = readLock(targetDir);
  const intent = readIntent(targetDir);
  const snapshot = expectedSnapshotFromLock(lock, versions, intent, targetDir, { allowDerivedAppAccessDrift: true });
  assertNoClassificationConflict(lock, snapshot);
  if (!runners?.runNimicodingSync) {
    throw new Error('Missing nimicoding sync runner');
  }
  runners.runNimicodingSync(targetDir, 'apply');

  for (const file of snapshot.filesWithoutLock) {
    const managedEntry = snapshot.lock.managedFileHashes[file.path];
    if (!managedEntry) {
      continue;
    }
    writeScaffoldFile(targetDir, file);
  }
  writeScaffoldFile(targetDir, {
    path: SCAFFOLD_LOCK_PATH,
    content: `${JSON.stringify(snapshot.lock, null, 2)}\n`,
  });

  validateAppProjectState(targetDir, versions, runners);
  const payload = {
    ok: true,
    command: 'sync',
    dir: targetDir,
    scaffoldVersion: snapshot.lock.scaffoldVersion,
    profile: snapshot.lock.profile,
    appId: snapshot.lock.appId,
    features: snapshot.lock.features,
    refreshedManagedFiles: Object.keys(snapshot.lock.managedFileHashes).length,
  };
  if (options.silent) {
    return payload;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`[nimi-app] sync refreshed managed scaffold files at ${targetDir}\n`);
  }
  return payload;
}
