#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NtExecutable,
  NtExecutableResource,
  Resource,
} from 'resedit';

import {
  parsePowerShellJsonResult,
  resolveWindowsPowerShell7,
} from './lib/windows-powershell.mjs';

// @nimi-authority: rule.nimi.platform.governance-release.p-gov-026-positioning

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const outputRoot = path.join(repoRoot, 'dist', 'release-preview', 'windows');
const version = parseVersion(process.argv.slice(2));
const previewTag = `v${version.text}`;
const assetBaseName = `Nimi-Runtime-${previewTag}-windows-x64-unsigned-bootstrap`;
const stagingRoot = path.join(outputRoot, assetBaseName);
const archivePath = path.join(outputRoot, `${assetBaseName}.zip`);
const executablePath = path.join(stagingRoot, 'nimi.exe');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows Runtime bootstrap must be built on Windows x64, got ${process.platform}/${process.arch}`);
}

const buildRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-windows-runtime-unsigned-bootstrap-'));
const rawExecutablePath = path.join(buildRoot, 'nimi-raw.exe');

try {
  rmSync(stagingRoot, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  mkdirSync(stagingRoot, { recursive: true });

  runChecked('go', [
    'build',
    '-trimpath',
    '-ldflags',
    `-s -w -X main.Version=${version.text}`,
    '-o',
    rawExecutablePath,
    './cmd/nimi',
  ], { cwd: runtimeDir });

  writeWindowsVersionInfo(rawExecutablePath, executablePath, version);
  const observed = observeWindowsExecutable(executablePath);
  assertUnsignedBootstrapObservation(observed, version);

  copyFileSync(path.join(runtimeDir, 'LICENSE'), path.join(stagingRoot, 'LICENSE'));
  writeFileSync(
    path.join(stagingRoot, 'UNSIGNED-BOOTSTRAP-windows.txt'),
    [
      'UNSIGNED WINDOWS RUNTIME BOOTSTRAP — NOT PROMOTABLE',
      `version=${version.text}`,
      'platform=windows/amd64',
      'executable=nimi.exe',
      '',
      'This archive contains an unsigned Nimi Runtime CLI executable built from the public repository.',
      'It is not a Nimi Desktop App, installer, Windows service, protected-local production release,',
      'or third-party App Registry admission. Windows policy may warn or block it.',
      '',
      'Use after extraction:',
      '  .\\nimi.exe version --json',
      '',
      'Remove:',
      '  Close any running nimi.exe process, then delete the extracted directory.',
      '',
      'This portable bootstrap does not install a service, modify PATH, write Program Files or ProgramData,',
      'or add a certificate to Windows trust stores. Production protected-local startup remains unavailable.',
      '',
      'Code signing policy: https://nimi.ai/code-signing',
      'Privacy: https://nimi.ai/privacy',
      'Source: https://github.com/nimiplatform/nimi',
      '',
    ].join('\n'),
    'utf8',
  );

  createZip(stagingRoot, archivePath);
} catch (error) {
  rmSync(archivePath, { force: true });
  throw error;
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(stagingRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  status: 'unsigned-bootstrap-built',
  version: version.text,
  platform: 'windows/amd64',
  archivePath,
})}\n`);

function parseVersion(args) {
  if (args.length !== 2 || args[0] !== '--version') {
    throw new Error('Usage: node scripts/build-windows-runtime-unsigned-bootstrap.mjs --version <X.Y.Z-preview.N>');
  }
  const text = String(args[1] || '').trim();
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.([1-9][0-9]*)$/u.exec(text);
  if (!match) {
    throw new Error(`Bootstrap version must be an exact X.Y.Z-preview.N SemVer: ${text || '<missing>'}`);
  }
  const numbers = match.slice(1).map((value) => Number(value));
  if (numbers.some((value) => !Number.isSafeInteger(value) || value > 65535)) {
    throw new Error('Bootstrap version components must fit Windows four-part version fields (0..65535)');
  }
  return {
    text,
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    preview: numbers[3],
  };
}

function writeWindowsVersionInfo(sourcePath, destinationPath, releaseVersion) {
  const executable = NtExecutable.from(readFileSync(sourcePath));
  const resources = NtExecutableResource.from(executable, true);
  const language = { lang: 1033, codepage: 1200 };
  const numericVersion = [
    releaseVersion.major,
    releaseVersion.minor,
    releaseVersion.patch,
    releaseVersion.preview,
  ].join('.');
  const versionInfo = Resource.VersionInfo.create({
    lang: language.lang,
    fixedInfo: {
      fileFlagsMask: 0x3f,
      fileFlags: Resource.VersionFileFlags.Prerelease,
      fileOS: Resource.VersionFileOS.NT_Windows32,
      fileType: Resource.VersionFileType.App,
    },
    strings: [{ lang: language.lang, codepage: language.codepage, values: {} }],
  });
  versionInfo.setFileVersion(numericVersion, language.lang);
  versionInfo.setProductVersion(numericVersion, language.lang);
  versionInfo.setStringValues(language, {
    CompanyName: 'Nimi Network Limited',
    FileDescription: 'Nimi Runtime',
    FileVersion: numericVersion,
    InternalName: 'nimi',
    LegalCopyright: 'Copyright (c) 2026 Nimi Network Limited',
    OriginalFilename: 'nimi.exe',
    ProductName: 'Nimi',
    ProductVersion: releaseVersion.text,
  });
  versionInfo.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  writeFileSync(destinationPath, Buffer.from(executable.generate()));
}

function observeWindowsExecutable(targetPath) {
  const result = spawnSync(resolveWindowsPowerShell7(), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      "$signature = Get-AuthenticodeSignature -LiteralPath $env:NIMI_BOOTSTRAP_EXECUTABLE",
      "$item = Get-Item -LiteralPath $env:NIMI_BOOTSTRAP_EXECUTABLE",
      '[ordered]@{',
      '  signatureStatus = [string]$signature.Status',
      '  signatureType = [string]$signature.SignatureType',
      '  signer = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject }',
      '  productName = $item.VersionInfo.ProductName',
      '  productVersion = $item.VersionInfo.ProductVersion',
      '  fileVersion = $item.VersionInfo.FileVersion',
      '  originalFilename = $item.VersionInfo.OriginalFilename',
      '} | ConvertTo-Json -Compress',
    ].join('\n'),
  ], {
    cwd: repoRoot,
    env: { ...process.env, NIMI_BOOTSTRAP_EXECUTABLE: targetPath },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to inspect unsigned bootstrap executable: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
  const observed = parsePowerShellJsonResult(result, 'windows-runtime-bootstrap-observation-invalid');
  const versionResult = spawnSync(targetPath, ['version', '--json'], {
    cwd: stagingRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (versionResult.error || versionResult.status !== 0) {
    throw new Error(`Unsigned bootstrap version command failed: ${versionResult.error?.message || versionResult.stderr || `exit ${versionResult.status}`}`);
  }
  try {
    observed.runtimeVersion = JSON.parse(versionResult.stdout);
  } catch (error) {
    throw new Error(`Unsigned bootstrap version output is invalid JSON: ${String(error)}`);
  }
  return observed;
}

function assertUnsignedBootstrapObservation(observed, expectedVersion) {
  const expectedFileVersion = [
    expectedVersion.major,
    expectedVersion.minor,
    expectedVersion.patch,
    expectedVersion.preview,
  ].join('.');
  if (
    observed.signatureStatus !== 'NotSigned'
    || observed.signatureType !== 'None'
    || observed.signer !== null
  ) {
    throw new Error(`Bootstrap executable must be genuinely unsigned: ${JSON.stringify(observed)}`);
  }
  if (
    observed.productName !== 'Nimi'
    || observed.productVersion !== expectedVersion.text
    || observed.originalFilename !== 'nimi.exe'
    || observed.fileVersion !== expectedFileVersion
  ) {
    throw new Error(`Bootstrap executable Windows version metadata is invalid: ${JSON.stringify(observed)}`);
  }
  if (
    observed.runtimeVersion?.nimi !== expectedVersion.text
    || observed.runtimeVersion?.osArch !== 'windows/amd64'
  ) {
    throw new Error(`Bootstrap executable reported the wrong Runtime identity: ${JSON.stringify(observed.runtimeVersion)}`);
  }
}

function createZip(sourceRoot, destinationPath) {
  const result = spawnSync(resolveWindowsPowerShell7(), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      "$ErrorActionPreference = 'Stop'",
      'Compress-Archive -Path (Join-Path $env:NIMI_BOOTSTRAP_STAGE_ROOT \'*\') -DestinationPath $env:NIMI_BOOTSTRAP_ARCHIVE -CompressionLevel Optimal',
    ].join('\n'),
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NIMI_BOOTSTRAP_STAGE_ROOT: sourceRoot,
      NIMI_BOOTSTRAP_ARCHIVE: destinationPath,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to create unsigned bootstrap ZIP: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || `exit ${result.status}`}`);
  }
}
