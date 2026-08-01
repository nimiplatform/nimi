#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs, {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveWindowsPowerShell7 } from './lib/windows-powershell.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const binaryPath = path.join(distDir, binaryName);
const windowsDevSigningScript = path.join(repoRoot, 'scripts', 'lib', 'windows-dev-signing.ps1');
const rootEnvPath = path.join(repoRoot, '.env');
const devAppIdentityProjectionPath = path.join(repoRoot, 'config', 'platform-nimi-app-identity-surfaces.yaml');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
    return null;
  }
  const separatorIndex = trimmed.indexOf('=');
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (!key) {
    return null;
  }
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function applyRootRuntimeEnv(env) {
  if (fs.existsSync(rootEnvPath)) {
    const raw = fs.readFileSync(rootEnvPath, 'utf8');
    for (const line of raw.split(/\r?\n/u)) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }
      const shouldApply = parsed.key.startsWith('NIMI_') || parsed.key.startsWith('VITE_NIMI_');
      if (shouldApply) {
        env[parsed.key] = parsed.value;
      } else if (env[parsed.key] == null) {
        env[parsed.key] = parsed.value;
      }
    }
  }
  if (
    !String(env.NIMI_RUNTIME_APP_IDENTITY_PROJECTION_PATH || '').trim()
    && fs.existsSync(devAppIdentityProjectionPath)
  ) {
    env.NIMI_RUNTIME_APP_IDENTITY_PROJECTION_PATH = devAppIdentityProjectionPath;
  }
  return env;
}

function shouldRunWindowsSigningDiagnostic(error, detail) {
  if (process.platform !== 'win32') {
    return false;
  }
  const errorCode = String(error?.code || '').toUpperCase();
  if (errorCode === 'UNKNOWN' || errorCode === 'EPERM' || errorCode === 'EACCES') {
    return true;
  }
  return /application control|code integrity|blocked this file|enterprise signing/i.test(String(detail || ''));
}

function writeWindowsSigningDiagnostic() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsDevSigningScript,
      '-Mode',
      'Diagnose',
      '-Path',
      binaryPath,
      '-Json',
    ],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.error) {
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic failed to start: ${result.error.message}\n`);
    return;
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n');
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic failed${detail ? `:\n${detail}\n` : '\n'}`);
    return;
  }

  try {
    const parsed = JSON.parse(String(result.stdout || '{}'));
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic:\n${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    process.stderr.write(`[run-runtime-dist] windows dev signing diagnostic:\n${String(result.stdout || '').trim()}\n`);
  }
}

export function runtimeCommandArgs(args = process.argv.slice(2)) {
  return [...args];
}

export function shouldElevateWindowsRuntimeCommand(args, platform = process.platform) {
  return platform === 'win32' && args[0] === 'stop';
}

function powerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

export function buildWindowsRunAsCommands({
  powershellPath,
  executablePath,
  args,
  stdoutPath,
  stderrPath,
}) {
  const runtimeArguments = args
    .map((arg) => `'${powerShellLiteral(arg)}'`)
    .join(' ');
  const innerCommand = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `& '${powerShellLiteral(executablePath)}' ${runtimeArguments} 1> '${powerShellLiteral(stdoutPath)}' 2> '${powerShellLiteral(stderrPath)}'`,
    'exit $LASTEXITCODE',
    '} catch {',
    `[IO.File]::AppendAllText('${powerShellLiteral(stderrPath)}', [Environment]::NewLine + $_.Exception.Message, [Text.UTF8Encoding]::new($false))`,
    'exit 1',
    '}',
  ].join('; ');
  const encodedInnerCommand = Buffer.from(innerCommand, 'utf16le').toString('base64');
  const outerCommand = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `$process = Start-Process -FilePath '${powerShellLiteral(powershellPath)}' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedInnerCommand}') -Wait -PassThru`,
    'exit $process.ExitCode',
    '} catch {',
    '[Console]::Error.WriteLine($_.Exception.Message)',
    'exit 1',
    '}',
  ].join('; ');
  return { innerCommand, outerCommand };
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function runElevatedWindowsRuntimeCommand(args) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-command-'));
  const stdoutPath = path.join(tempRoot, 'stdout.txt');
  const stderrPath = path.join(tempRoot, 'stderr.txt');
  try {
    const powershellPath = resolveWindowsPowerShell7();
    const { outerCommand } = buildWindowsRunAsCommands({
      powershellPath,
      executablePath: binaryPath,
      args,
      stdoutPath,
      stderrPath,
    });
    const encodedCommand = Buffer.from(outerCommand, 'utf16le').toString('base64');
    const result = spawnSync(
      powershellPath,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    return {
      ...result,
      stdout: safeRead(stdoutPath),
      stderr: [safeRead(stderrPath), String(result.stderr || '').trim()]
        .filter(Boolean)
        .join('\n'),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function main() {
  if (!fs.existsSync(binaryPath)) {
    process.stderr.write(`[run-runtime-dist] missing ${path.relative(repoRoot, binaryPath)}; run 'pnpm build:runtime' first.\n`);
    return 1;
  }

  const args = runtimeCommandArgs();
  if (shouldElevateWindowsRuntimeCommand(args)) {
    let result;
    try {
      result = runElevatedWindowsRuntimeCommand(args);
    } catch (error) {
      process.stderr.write(`[run-runtime-dist] failed to request Windows elevation: ${error.message}\n`);
      return 1;
    }
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    }
    if (result.error) {
      process.stderr.write(`[run-runtime-dist] elevated Runtime command failed to start: ${result.error.message}\n`);
      return 1;
    }
    return result.status ?? 1;
  }

  const runtimeEnv = applyRootRuntimeEnv({ ...process.env });

  const child = spawn(binaryPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: runtimeEnv,
  });

  let childExited = false;

  const forwardSignal = (signal) => {
    if (childExited || child.pid == null) {
      return;
    }
    try {
      child.kill(signal);
    } catch {
      // Child exit races are expected during shutdown.
    }
  };

  const cleanupSignals = () => {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
  };

  const onSigInt = () => {
    if (process.platform === 'win32') {
      forwardSignal('SIGINT');
    }
  };
  const onSigTerm = () => {
    forwardSignal('SIGTERM');
  };

  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  return new Promise((resolve) => {
    child.once('error', (error) => {
      childExited = true;
      cleanupSignals();
      process.stderr.write(`[run-runtime-dist] failed to start ${path.relative(repoRoot, binaryPath)}: ${error.message}\n`);
      if (shouldRunWindowsSigningDiagnostic(error, error.message)) {
        writeWindowsSigningDiagnostic();
      }
      resolve(1);
    });

    child.once('exit', (code, signal) => {
      childExited = true;
      cleanupSignals();
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
