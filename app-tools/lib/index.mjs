import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  buildAppScaffoldCandidateCreatePlan,
  buildAppScaffoldCreatePlan,
  createAppScaffold,
  createAppScaffoldCandidate,
  resolveAppScaffoldCandidateCreateInput,
  resolveAppScaffoldCreateInput,
} from './app-scaffold.mjs';
import { initApp } from './app-doctor-update.mjs';
import {
  buildAppProject,
  checkAppProject,
  syncAppProject,
  testAppProject,
} from './app-project-lifecycle.mjs';
import { aggregateAppTargetCandidates, packAppTarget } from './app-pack.mjs';
export { runDevShell } from '../scripts/dev-shell.mjs';
export {
  validateSimulatorAppSource,
  validateSimulatorAppSourceWithCanonicalKitExports,
} from './simulator-conformance.mjs';
export { APP_SCAFFOLD_FEATURE_IDS } from './app-scaffold-capabilities.mjs';

const APP_TOOLS_PACKAGE_MANIFEST = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
if (!APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions
  || typeof APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions !== 'object'
  || Array.isArray(APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions)) {
  throw new Error('app-tools package manifest is missing nimiScaffoldVersions');
}
const SCAFFOLD_VERSIONS = Object.freeze({ ...APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions });

function ensureDirEmptyOrMissing(targetDir) {
  if (!existsSync(targetDir)) {
    return;
  }
  const stat = statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error(`Refusing to scaffold into non-directory path: ${targetDir}`);
  }
  const entries = readdirSync(targetDir);
  if (entries.length === 0) {
    return;
  }
  if (entries.length === 1 && entries[0] === '.git' && statSync(path.join(targetDir, '.git')).isDirectory()) {
    return;
  }
  throw new Error(`Refusing to scaffold into non-empty directory: ${targetDir}`);
}

function createFileTree(baseDir, files) {
  for (const file of files) {
    const targetPath = path.join(baseDir, file.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }
}

export function appScaffoldVersions() {
  return { ...SCAFFOLD_VERSIONS };
}

function runNimicodingSync(targetDir, mode) {
  if (!['apply', 'check'].includes(mode)) {
    throw new Error(`Unsupported nimicoding sync mode: ${mode}`);
  }
  const flag = mode === 'apply' ? '--apply' : '--check';
  const pnpmArgs = ['--silent', 'exec', 'nimicoding', 'sync', flag, '--json'];
  const command =
    process.platform === 'win32'
      ? { binary: 'cmd.exe', args: ['/d', '/c', 'corepack', 'pnpm', ...pnpmArgs] }
      : { binary: 'corepack', args: ['pnpm', ...pnpmArgs] };
  const result = spawnSync(command.binary, command.args, {
    cwd: targetDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const output = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`nimicoding sync ${mode} failed. Run pnpm install before rerunning the lifecycle command. ${output}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`nimicoding sync ${mode} returned invalid JSON: ${message}`);
  }
}

function runAppCommand(targetDir, command, options = {}) {
  const result = spawnSync(command, {
    cwd: targetDir,
    shell: true,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: [result.error?.message, result.stderr].filter(Boolean).join('\n'),
  };
}

function signWindowsTarget(targetDir, relativePayloadPath) {
  const targetPath = path.resolve(targetDir, ...relativePayloadPath.split('/'));
  const rootPrefix = `${path.resolve(targetDir)}${path.sep}`;
  if (!targetPath.startsWith(rootPrefix) || !existsSync(targetPath) || !statSync(targetPath).isFile()) {
    throw new Error(`Windows production signing target is missing: ${relativePayloadPath}`);
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_BASE64) -or [string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_PASSWORD)) { throw 'Windows signing credentials are missing' }",
    "$pfxPath = Join-Path ([IO.Path]::GetTempPath()) ('nimi-app-sign-' + [guid]::NewGuid().ToString('N') + '.pfx')",
    '$cert = $null',
    'try {',
    '  [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))',
    '  $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force',
    "  $cert = Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation 'Cert:\\CurrentUser\\My' -Password $password -Exportable:$false",
    "  if (-not $cert) { throw 'Windows signing certificate import failed' }",
    "  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\\10\\bin'",
    "  $signTool = Get-ChildItem -LiteralPath $kitsRoot -Filter 'signtool.exe' -Recurse -File | Where-Object { $_.FullName -match '\\\\x64\\\\signtool\\.exe$' } | Sort-Object FullName -Descending | Select-Object -First 1",
    "  if (-not $signTool) { throw 'signtool.exe was not found' }",
    "  & $signTool.FullName sign /fd SHA256 /td SHA256 /tr 'http://timestamp.digicert.com' /sha1 $cert.Thumbprint $env:NIMI_APP_SIGN_TARGET",
    "  if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }",
    '  $signature = Get-AuthenticodeSignature -LiteralPath $env:NIMI_APP_SIGN_TARGET',
    "  if ($signature.Status -ne 'Valid') { throw ('Authenticode status: ' + $signature.Status) }",
    '  $signature.SignerCertificate.Subject',
    '} finally {',
    "  if ($cert) { Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue }",
    '  [IO.File]::Delete($pfxPath)',
    '}',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: targetDir,
    encoding: 'utf8',
    env: { ...process.env, NIMI_APP_SIGN_TARGET: targetPath },
  });
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Windows production signing failed${detail ? `: ${detail}` : ''}`);
  }
  return { subject: String(result.stdout || '').trim() };
}

function appToolRunners() {
  return { runNimicodingSync, runAppCommand, signWindowsTarget };
}

export function createApp(cwd, options = {}) {
  const plan = options.plan || resolveAppCreatePlan(cwd, options);
  return createAppScaffold({
    cwd,
    options: {
      dir: options.dir,
      profile: options.profile,
      appId: options.appId,
      name: options.name,
      title: options.title,
      packageName: options.packageName,
      author: options.author,
      features: options.features,
      silent: options.silent,
    },
    versions: appScaffoldVersions(),
    createFileTree,
    ensureDirEmptyOrMissing,
    mkdirSync,
    plan,
  });
}

export function resolveAppCreateInput(cwd, options = {}) {
  return resolveAppScaffoldCreateInput({ cwd, options });
}

export function resolveAppCreatePlan(cwd, options = {}) {
  return resolveAppCreatePlanWith(
    cwd,
    options,
    resolveAppScaffoldCreateInput,
    buildAppScaffoldCreatePlan,
  );
}

export function resolveCandidateAppCreatePlan(cwd, options = {}) {
  return resolveAppCreatePlanWith(
    cwd,
    options,
    resolveAppScaffoldCandidateCreateInput,
    buildAppScaffoldCandidateCreatePlan,
  );
}

function resolveAppCreatePlanWith(cwd, options, resolveInput, buildPlan) {
  const resolvedInput = resolveInput({ cwd, options });
  ensureDirEmptyOrMissing(resolvedInput.targetDir);
  const topology = resolveCreateTopology();
  const versions = appScaffoldVersions();
  const plan = buildPlan({ cwd, options, versions, topology });
  return plan;
}

export function createCandidateApp(cwd, options = {}) {
  const plan = options.plan || resolveCandidateAppCreatePlan(cwd, options);
  return createAppScaffoldCandidate({
    cwd,
    options,
    versions: appScaffoldVersions(),
    createFileTree,
    ensureDirEmptyOrMissing,
    mkdirSync,
    plan,
  });
}

function resolveCreateTopology() {
  return Object.freeze({ profile: 'standalone' });
}

export function initAppScaffold(cwd, options = {}) {
  return initApp(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function syncApp(cwd, options = {}) {
  return syncAppProject(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function checkApp(cwd, options = {}) {
  return checkAppProject(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function testApp(cwd, options = {}) {
  return testAppProject(cwd, options, appToolRunners());
}

export function buildApp(cwd, options = {}) {
  return buildAppProject(cwd, options, appToolRunners());
}

export function packApp(cwd, options = {}) {
  return options.aggregate
    ? aggregateAppTargetCandidates(cwd, options)
    : packAppTarget(cwd, options);
}
