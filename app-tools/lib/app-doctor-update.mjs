import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildAppScaffoldSnapshot,
  buildAppScaffoldSnapshotFromIntent,
  hashScaffoldContent,
  SCAFFOLD_BUILD_PROFILE_PATH,
  SCAFFOLD_INTENT_PATH,
  SCAFFOLD_LOCK_PATH,
  SCAFFOLD_SUBMISSION_PATH,
  SCAFFOLD_VERSION,
  SUPPORTED_APP_SCAFFOLD_PROFILES,
} from './app-scaffold.mjs';

const SCAN_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.turbo', '.vite']);
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
  if (lock?.scaffoldVersion !== SCAFFOLD_VERSION) {
    throw new Error(`Unsupported scaffold version: ${String(lock?.scaffoldVersion || 'missing')}`);
  }
  if (!SUPPORTED_APP_SCAFFOLD_PROFILES.includes(lock?.profile)) {
    throw new Error(`Unsupported scaffold profile: ${String(lock?.profile || 'missing')}`);
  }
  if (!lock.appId || !lock.appTitle) {
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

function expectedSnapshotFromLock(lock, versions) {
  assertSupportedLock(lock);
  return buildAppScaffoldSnapshot({
    profile: lock.profile,
    versions,
    appId: lock.appId,
    appTitle: lock.appTitle,
    packageName: lock.packageName,
    author: lock.packageAuthor || '',
  });
}

function readContentForHash(filePath) {
  return readFileSync(filePath);
}

function ensureLockMatchesCurrentGenerator(lock, snapshot) {
  assertSameJson(lock.appIdentity, snapshot.lock.appIdentity, 'App identity');
  assertSameJson(lock.packageName, snapshot.lock.packageName, 'Package name');
  assertSameJson(lock.packageAuthor, snapshot.lock.packageAuthor, 'Package author');
  assertSameJson(lock.cargoPackageName, snapshot.lock.cargoPackageName, 'Cargo package name');
  assertSameJson(lock.tauriIdentifier, snapshot.lock.tauriIdentifier, 'Tauri identifier');
  assertSameJson(lock.managedFileTaxonomy, snapshot.lock.managedFileTaxonomy, 'Managed file taxonomy');
  assertSameJson(lock.dependencyMatrix, snapshot.lock.dependencyMatrix, 'Dependency matrix');
  assertSameJson(lock.managedFileHashes, snapshot.lock.managedFileHashes, 'Managed file hashes');
  assertSameJson(lock.appOwnedInitialHashes, snapshot.lock.appOwnedInitialHashes, 'App-owned taxonomy hashes');
  assertSameJson(lock.semantics, snapshot.lock.semantics, 'Scaffold semantics');
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
      if (
        relativePath.startsWith('.nimi/config/')
        || relativePath.startsWith('.nimi/contracts/')
        || relativePath.startsWith('.nimi/methodology/')
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
  const retiredFlag = ['--', 'template'].join('');
  const modelTestImport = ['kit', 'features', 'model-test'].join('/');
  const retiredProfiles = ['basic', ['vercel', 'ai'].join('-')];
  const retiredBuilders = [
    ['build', 'Basic', 'App', 'Template'].join(''),
    ['build', 'VercelAI', 'App', 'Template'].join(''),
  ].join('|');
  return [
    ['generic platform auth helper in scaffold', /createPlatformClient\s*\(/],
    ['first-party helper in third-party scaffold', /createLocalFirstPartyRuntimePlatformClient/],
    ['Realm login bypass endpoint', /\/api\/auth\/login/],
    ['Realm refresh bypass endpoint', /\/api\/auth\/refresh/],
    ['app-owned session store', /sessionStore/],
    ['app-owned refresh token provider', /refreshTokenProvider/],
    ['raw bearer token custody wording', /raw JWT/i],
    ['model-test import', new RegExp(modelTestImport.replace('/', '\\/'))],
    ['stale Runtime shell API', new RegExp(runtimeBridgeName)],
    ['retired template flag', new RegExp(retiredFlag.replace('-', '\\-'))],
    ['retired template builder', new RegExp(retiredBuilders)],
    ['retired kit package name', /@nimiplatform\/nimi-kit/],
    ['retired developer tools package name', /@nimiplatform\/dev-tools/],
    ['retired profile switch branch', new RegExp(`case\\s+['"](?:${retiredProfiles.join('|')})['"]`)],
    ['retired submitted profile', new RegExp(`(?:profile|template):\\s*(?:${retiredProfiles.join('|')})\\b`)],
    ['retired vercel profile remnant', new RegExp(retiredProfiles[1])],
    ['provider/model hardcoding', buildProviderModelHardcodingPattern()],
    ['local audit wording promoted to admission', /local[\s-]+audit[\s-]+as[\s-]+admission/i],
    ['manifest wording promoted to grant', /manifest[\s-]+as[\s-]+grant/i],
    ['installed-app update claim', /installed[\s-]+app[\s-]+update[\s-]+truth:\s*(?!not-generated)/i],
  ];
}

function scanForbiddenPatterns(targetDir) {
  const findings = [];
  const patterns = buildForbiddenPatterns();
  for (const filePath of collectTextFiles(targetDir)) {
    const relativePath = path.relative(targetDir, filePath).split(path.sep).join('/');
    const text = readFileSync(filePath, 'utf8');
    const isTestFile = relativePath.startsWith('test/') || relativePath.endsWith('.test.mjs');
    for (const [label, pattern] of patterns) {
      // Test files reference provider/model names to assert behavior (including
      // negative assertions that forbid hardcoding); only product/glue source is
      // product truth, so the hardcoding pattern is scoped out of tests.
      if (label === 'provider/model hardcoding' && isTestFile) {
        continue;
      }
      if (pattern.test(text)) {
        findings.push(`${relativePath}: ${label}`);
      }
    }
  }
  return findings;
}

function readYamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return match ? match[1].trim() : '';
}

function assertRequiredSupportFiles(targetDir, snapshot) {
  const missing = [];
  for (const file of snapshot.files) {
    if (!existsSync(path.join(targetDir, file.path))) {
      missing.push(file.path);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required scaffold support files: ${missing.join(', ')}`);
  }

  const tauriConfig = JSON.parse(readFileSync(path.join(targetDir, 'src-tauri/tauri.conf.json'), 'utf8'));
  const icons = tauriConfig?.bundle?.icon;
  if (!Array.isArray(icons) || icons.join(',') !== 'icons/icon.png') {
    throw new Error('Tauri icon support drift: bundle.icon must be ["icons/icon.png"]');
  }
  const icon = readFileSync(path.join(targetDir, 'src-tauri/icons/icon.png'));
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (icon.length !== 68 || pngSignature.some((value, index) => icon[index] !== value)) {
    throw new Error('Tauri icon support drift: src-tauri/icons/icon.png is not the scaffold PNG');
  }
}

function assertSemanticMarkers(targetDir) {
  const manifest = readFileSync(path.join(targetDir, 'nimi.app.yaml'), 'utf8');
  if (!manifest.includes('manifest_role: submitted-input')) {
    throw new Error('Submitted manifest marker missing');
  }
  if (/admitted|descriptor_role:\s*release|grant(ed)?_permissions/i.test(manifest)) {
    throw new Error('Submitted manifest contains admission or grant wording');
  }

  const submission = readFileSync(path.join(targetDir, SCAFFOLD_SUBMISSION_PATH), 'utf8');
  for (const marker of [
    'submission_role: developer-submitted-input',
    'init_command: pnpm run init',
    'dev_shell_command: pnpm dev:shell',
    'admission_truth: platform-owned-after-review',
  ]) {
    if (!submission.includes(marker)) {
      throw new Error(`Admission submission marker missing: ${marker}`);
    }
  }
  if (/admitted|descriptor_role:\s*release|grant(ed)?_permissions/i.test(submission)) {
    throw new Error('Admission submission contains admission or grant wording');
  }

  const buildProfile = readFileSync(path.join(targetDir, SCAFFOLD_BUILD_PROFILE_PATH), 'utf8');
  for (const marker of [
    'build_profile_ref:',
    'toolchain_version:',
    'install_command:',
    'init_command:',
    'build_command:',
    'output_path:',
    'lockfile_path:',
    'lockfile_policy:',
    'ci_install_command:',
    'profile_role: developer-workflow-input',
  ]) {
    if (!buildProfile.includes(marker)) {
      throw new Error(`Build profile marker missing: ${marker}`);
    }
  }
  if (/checksum-pinned|ordinary-user install|direct npm install|direct npx|direct clone/i.test(buildProfile)) {
    throw new Error('Build profile contains stale install or admission wording');
  }
  const ciWorkflow = readFileSync(path.join(targetDir, '.github/workflows/ci.yml'), 'utf8');
  const lockfilePath = readYamlScalar(buildProfile, 'lockfile_path');
  const lockfilePolicy = readYamlScalar(buildProfile, 'lockfile_policy');
  const ciInstallCommand = readYamlScalar(buildProfile, 'ci_install_command');
  if (lockfilePath !== 'pnpm-lock.yaml') {
    throw new Error(`Build profile lockfile path must be pnpm-lock.yaml: ${lockfilePath}`);
  }
  if (lockfilePolicy !== 'author-install-generates-lockfile') {
    throw new Error(`Build profile lockfile policy mismatch: ${lockfilePolicy}`);
  }
  if (!ciWorkflow.includes(`- run: ${ciInstallCommand}`)) {
    throw new Error('CI install command does not match build profile');
  }
  const lockfileExists = existsSync(path.join(targetDir, lockfilePath));
  if (!lockfileExists && /--frozen-lockfile/.test(ciWorkflow)) {
    throw new Error(`CI uses frozen lockfile install but lockfile is missing: ${lockfilePath}`);
  }
  if (!lockfileExists && /^\s*cache:\s*pnpm\s*$/m.test(ciWorkflow)) {
    throw new Error(`CI enables pnpm cache before lockfile exists: ${lockfilePath}`);
  }

  const agents = readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8');
  for (const marker of [
    'app-scaffold intent and lock',
    '@nimiplatform/nimi-coding',
    'scaffold-managed files',
    'app-owned area',
    'pre-submission self-checks only',
  ]) {
    if (!agents.includes(marker)) {
      throw new Error(`AGENTS.md boundary text missing: ${marker}`);
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

function validateDoctorState(targetDir, versions, runners = {}) {
  const lock = readLock(targetDir);
  const snapshot = expectedSnapshotFromLock(lock, versions);
  ensureLockMatchesCurrentGenerator(lock, snapshot);
  assertRequiredSupportFiles(targetDir, snapshot);
  assertSemanticMarkers(targetDir);
  assertManagedFilesCurrent(targetDir, lock);
  assertNimicodingProjectionCurrent(targetDir, runners);
  const forbiddenFindings = scanForbiddenPatterns(targetDir);
  if (forbiddenFindings.length > 0) {
    throw new Error(`Forbidden scaffold remnants detected: ${forbiddenFindings.join('; ')}`);
  }
  return {
    targetDir,
    lock,
    snapshot,
  };
}

export function initApp(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const intent = readIntent(targetDir);
  const snapshot = buildAppScaffoldSnapshotFromIntent({ intent, versions });
  if (!runners?.runNimicodingSync) {
    throw new Error('Missing nimicoding sync runner');
  }
  const nimicoding = runners.runNimicodingSync(targetDir, 'apply');
  for (const file of snapshot.initFiles) {
    writeScaffoldFile(targetDir, file);
  }
  validateDoctorState(targetDir, versions, runners);
  const payload = {
    ok: true,
    command: 'init',
    dir: targetDir,
    scaffoldVersion: snapshot.lock.scaffoldVersion,
    profile: snapshot.lock.profile,
    appId: snapshot.lock.appId,
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

export function doctorApp(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const result = validateDoctorState(targetDir, versions, runners);
  const payload = {
    ok: true,
    command: 'doctor',
    dir: targetDir,
    scaffoldVersion: result.lock.scaffoldVersion,
    profile: result.lock.profile,
    appId: result.lock.appId,
    checkedManagedFiles: Object.keys(result.lock.managedFileHashes || {}).length,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`[nimi-app] doctor passed for ${targetDir}\n`);
  }
  return payload;
}

function collectExpectedClasses(snapshot) {
  const entries = new Map();
  for (const [relativePath, entry] of Object.entries(snapshot.lock.managedFileHashes)) {
    entries.set(relativePath, entry.class);
  }
  for (const [relativePath, entry] of Object.entries(snapshot.lock.appOwnedInitialHashes)) {
    entries.set(relativePath, entry.class);
  }
  return entries;
}

function assertNoClassificationConflict(lock, snapshot) {
  const currentClasses = collectExpectedClasses(snapshot);
  for (const [relativePath, entry] of Object.entries(lock.managedFileHashes || {})) {
    if (currentClasses.get(relativePath) !== entry.class) {
      throw new Error(`Scaffold classification conflict: ${relativePath}`);
    }
  }
  for (const [relativePath, entry] of Object.entries(lock.appOwnedInitialHashes || {})) {
    if (currentClasses.get(relativePath) !== entry.class) {
      throw new Error(`Scaffold classification conflict: ${relativePath}`);
    }
  }
}

function writeScaffoldFile(targetDir, file) {
  const targetPath = path.join(targetDir, file.path);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, file.content);
}

export function updateApp(cwd, options = {}, versions, runners = {}) {
  const targetDir = resolveTargetDir(cwd, options);
  const lock = readLock(targetDir);
  const snapshot = expectedSnapshotFromLock(lock, versions);
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

  validateDoctorState(targetDir, versions, runners);
  const payload = {
    ok: true,
    command: 'update',
    dir: targetDir,
    scaffoldVersion: snapshot.lock.scaffoldVersion,
    profile: snapshot.lock.profile,
    appId: snapshot.lock.appId,
    refreshedManagedFiles: Object.keys(snapshot.lock.managedFileHashes).length,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`[nimi-app] update refreshed managed scaffold files at ${targetDir}\n`);
  }
  return payload;
}
