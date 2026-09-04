import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregateAppTargetCandidates,
  classifyWindowsNativeTrustObservation,
  packAppTarget,
  readNimiAppArchive,
  writeNimiAppArchive,
} from '../lib/app-pack.mjs';
import { observeWindowsExecutableFacts, windowsPowerShellEnv } from '../lib/windows-powershell.mjs';

const WINDOWS_X86_64 = process.platform === 'win32' && process.arch === 'x64';

test('Windows PowerShell child processes do not inherit PowerShell 7 module paths', () => {
  const env = windowsPowerShellEnv(
    { NIMI_APP_EXECUTABLE_PATH: 'C:\\observed\\app.exe' },
    { PATH: 'C:\\Windows', PSModulePath: 'C:\\Program Files\\PowerShell\\Modules', pSmOdUlEpAtH: 'duplicate' },
  );
  assert.deepEqual(env, {
    PATH: 'C:\\Windows',
    NIMI_APP_EXECUTABLE_PATH: 'C:\\observed\\app.exe',
  });
});

function fixture(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-pack-'));
  mkdirSync(path.join(root, '.nimi', 'config'), { recursive: true });
  mkdirSync(path.join(root, 'build', 'windows'), { recursive: true });
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'example-app', version: '0.1.0', private: true }, null, 2)}\n`);
  writeFileSync(path.join(root, 'LICENSE'), 'Example App License\n');
  writeFileSync(path.join(root, 'nimi.app.yaml'), [
    'app_id: example.app',
    'display_name: Example App',
    'version: 0.1.0',
    'profile: standalone',
    'manifest_role: submitted-input',
    'app_access: []',
    '',
  ].join('\n'));
  writeFileSync(path.join(root, '.nimi', 'config', 'build-profile.yaml'), [
    `build_profile_ref: ${options.buildProfileRef || 'electron-packager-pnpm-vite'}`,
    'test_command: node --test',
    'build_command: node build.mjs',
    'targets:',
    '  windows-x86_64:',
    '    os: windows',
    '    arch: x86_64',
    '    payload_path: build/windows',
    '    runtime_entry: payload/example-app.exe',
    'profile_role: developer-workflow-input',
    '',
  ].join('\n'));
  writeFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname = "example-app"\nversion = "0.1.0"\n');
  writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), '{"version":"0.1.0"}\n');
  writeFileSync(path.join(root, 'build', 'windows', 'example-app.exe'), Buffer.from([0, 1, 2, 3, 4]));
  writeFileSync(path.join(root, 'build', 'windows', 'resource.txt'), 'resource\n');
  return root;
}

function runtimeEntryPath(root) {
  return path.join(root, 'build', 'windows', 'example-app.exe');
}

function compileUnsignedWindowsPe(root, options = {}) {
  const windowsRoot = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windowsRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  const compiler = candidates.find((candidate) => existsSync(candidate));
  assert.ok(compiler, 'A real Windows C# compiler is required for the unsigned PE test');
  const supportDir = path.join(root, '.test-pe');
  mkdirSync(supportDir, { recursive: true });
  const sourcePath = path.join(supportDir, 'Program.cs');
  const manifestPath = path.join(supportDir, 'app.manifest');
  writeFileSync(sourcePath, 'internal static class Program { [System.STAThread] private static void Main() {} }\n');
  const target = options.target || 'winexe';
  const args = ['/nologo', `/target:${target}`, `/platform:${options.platform || 'x64'}`, `/out:${runtimeEntryPath(root)}`];
  if (options.manifest === false) {
    args.push('/nowin32manifest');
  } else {
    const level = options.level || 'asInvoker';
    const uiAccess = options.uiAccess === true
      ? 'true'
      : options.uiAccess === 'empty' ? '' : 'false';
    const uiAccessAttribute = options.uiAccess === 'missing' ? '' : ` uiAccess="${uiAccess}"`;
    const assemblyNamespace = options.assemblyNamespace || 'urn:schemas-microsoft-com:asm.v1';
    const mixedNamespaces = options.manifestStyle === 'v2-v3';
    const trustNamespace = options.trustNamespace || (mixedNamespaces
      ? 'urn:schemas-microsoft-com:asm.v2'
      : 'urn:schemas-microsoft-com:asm.v3');
    const privilegesNamespace = mixedNamespaces
      ? ' xmlns="urn:schemas-microsoft-com:asm.v3"'
      : '';
    const executionNamespace = options.executionNamespace
      ? ` xmlns="${options.executionNamespace}"`
      : '';
    const manifestVersionAttribute = options.manifestVersion === 'missing'
      ? ''
      : ` manifestVersion="${options.manifestVersion || '1.0'}"`;
    const additionalExecutionLevel = options.additionalLevel
      ? `      <requestedExecutionLevel level="${options.additionalLevel}" uiAccess="false" />`
      : null;
    writeFileSync(manifestPath, [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      `<assembly xmlns="${assemblyNamespace}"${manifestVersionAttribute}>`,
      `  <trustInfo xmlns="${trustNamespace}">`,
      `    <security><requestedPrivileges${privilegesNamespace}>`,
      `      <requestedExecutionLevel${executionNamespace} level="${level}"${uiAccessAttribute} />`,
      additionalExecutionLevel,
      '    </requestedPrivileges></security>',
      '  </trustInfo>',
      '</assembly>',
      '',
    ].filter((line) => line !== null).join('\n'));
    args.push(`/win32manifest:${manifestPath}`);
  }
  args.push(sourcePath);
  const result = spawnSync(compiler, args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'));
  if (target === 'library' && options.manifest !== false) {
    const kitsRoot = path.join(process.env['ProgramFiles(x86)'] || '', 'Windows Kits', '10', 'bin');
    const mt = existsSync(kitsRoot)
      ? readdirSync(kitsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(kitsRoot, entry.name, 'x64', 'mt.exe'))
        .filter(existsSync)
        .sort()
        .at(-1)
      : null;
    assert.ok(mt, 'A real Windows mt.exe is required for the DLL process-manifest test');
    const manifestResult = spawnSync(mt, [
      '-nologo', '-manifest', manifestPath, `-outputresource:${runtimeEntryPath(root)};#1`,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(manifestResult.status, 0, [manifestResult.error?.message, manifestResult.stdout, manifestResult.stderr].filter(Boolean).join('\n'));
  }
  if (options.subsystem !== undefined) {
    const bytes = readFileSync(runtimeEntryPath(root));
    const peOffset = bytes.readUInt32LE(0x3c);
    bytes.writeUInt16LE(options.subsystem, peOffset + 24 + 68);
    writeFileSync(runtimeEntryPath(root), bytes);
  }
  return runtimeEntryPath(root);
}

function copyRealSignedWindowsPe(root) {
  const programFiles = [process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean);
  const candidates = [
    ...programFiles.map((base) => path.join(base, 'Git', 'cmd', 'git.exe')),
    ...programFiles.map((base) => path.join(base, 'PowerShell', '7', 'pwsh.exe')),
    process.execPath,
  ];
  const failures = [];
  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) continue;
    try {
      const observed = observeWindowsExecutableFacts(candidate);
      if (
        observed.authenticode.status !== 'Valid'
        || observed.authenticode.signature_type !== 'Authenticode'
        || !observed.authenticode.certificate_subject
      ) continue;
      writeFileSync(runtimeEntryPath(root), readFileSync(candidate));
      return { candidate, observed };
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No real signed asInvoker/uiAccess=false Windows PE is available${failures.length ? `:\n${failures.join('\n')}` : ''}`);
}

function tamperFirstPeCodeSection(executablePath) {
  const bytes = readFileSync(executablePath);
  const peOffset = bytes.readUInt32LE(0x3c);
  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = bytes.readUInt16LE(peOffset + 20);
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  let tamperOffset = -1;
  for (let index = 0; index < sectionCount; index += 1) {
    const sectionOffset = sectionTableOffset + index * 40;
    const sizeOfRawData = bytes.readUInt32LE(sectionOffset + 16);
    const pointerToRawData = bytes.readUInt32LE(sectionOffset + 20);
    const characteristics = bytes.readUInt32LE(sectionOffset + 36);
    if ((characteristics & 0x00000020) !== 0 && sizeOfRawData > 0) {
      tamperOffset = pointerToRawData + Math.min(16, sizeOfRawData - 1);
      break;
    }
  }
  assert.ok(tamperOffset >= 0 && tamperOffset < bytes.length, 'signed PE must contain a bounded code section');
  bytes[tamperOffset] ^= 0x01;
  writeFileSync(executablePath, bytes);
}

test('native trust classifier rejects every unsupported status, type, or signer tuple', () => {
  for (const observation of [
    { status: 'NotTrusted', signature_type: 'Authenticode', certificate_subject: 'CN=Publisher' },
    { status: 'UnknownError', signature_type: 'None', certificate_subject: null },
    { status: 'HashMismatch', signature_type: 'Authenticode', certificate_subject: 'CN=Publisher' },
    { status: 'Valid', signature_type: 'Authenticode', certificate_subject: null },
    { status: 'Valid', signature_type: 'Catalog', certificate_subject: 'CN=Publisher' },
    { status: 'NotSigned', signature_type: 'None', certificate_subject: 'CN=Publisher' },
    { status: 'NotSigned', signature_type: 'Authenticode', certificate_subject: null },
  ]) {
    assert.throws(
      () => classifyWindowsNativeTrustObservation(observation),
      /Windows Authenticode verification failed/u,
    );
  }
});

test('pack emits one deterministic target archive and canonical target metadata', () => {
  const root = fixture();
  try {
    const first = packAppTarget(root, { target: 'windows-x86_64' });
    const firstBytes = readFileSync(first.artifactPath);
    const second = packAppTarget(root, { target: 'windows-x86_64' });
    const secondBytes = readFileSync(second.artifactPath);
    assert.deepEqual(secondBytes, firstBytes);
    assert.equal(second.sha256, first.sha256);
    assert.equal(second.target_id, 'windows-x86_64');
    assert.deepEqual(second.native_trust, { posture: 'development-unsigned' });

    const entries = readNimiAppArchive(firstBytes);
    assert.deepEqual([...entries.keys()], [
      'LICENSE',
      'manifest.json',
      'nimi.app.yaml',
      'payload/example-app.exe',
      'payload/resource.txt',
    ]);
    assert.equal(entries.get('payload/example-app.exe').mode, 0o755);
    assert.equal(entries.get('LICENSE').bytes.toString('utf8'), 'Example App License\n');
    const manifest = JSON.parse(entries.get('manifest.json').bytes.toString('utf8'));
    assert.deepEqual({ app: manifest.app_id, version: manifest.version, target: manifest.target_id }, {
      app: 'example.app',
      version: '0.1.0',
      target: 'windows-x86_64',
    });
    assert.equal(manifest.runtime_entry, 'payload/example-app.exe');
    assert.equal(manifest.execution_profile, null);
    assert.ok(entries.has('payload/resource.txt'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production pack accepts a real unsigned asInvoker Windows PE and preserves exact facts', { skip: !WINDOWS_X86_64 }, () => {
  const root = fixture();
  try {
    const executablePath = compileUnsignedWindowsPe(root);
    const observed = observeWindowsExecutableFacts(executablePath);
    assert.deepEqual(observed.authenticode, {
      status: 'NotSigned',
      signature_type: 'None',
      certificate_subject: null,
    });
    assert.deepEqual(observed.execution_profile, { requested_execution_level: 'asInvoker', ui_access: false });

    const packed = packAppTarget(root, { target: 'windows-x86_64', production: true });
    assert.deepEqual(packed.native_trust, {
      posture: 'production-unsigned',
      windows_authenticode: 'unsigned',
      certificate_subject: null,
    });
    assert.deepEqual(packed.execution_profile, { requested_execution_level: 'asInvoker', ui_access: false });
    const manifest = JSON.parse(readNimiAppArchive(readFileSync(packed.artifactPath)).get('manifest.json').bytes.toString('utf8'));
    const metadata = JSON.parse(readFileSync(packed.metadataPath, 'utf8'));
    assert.deepEqual(manifest.native_trust, packed.native_trust);
    assert.deepEqual(manifest.execution_profile, packed.execution_profile);
    assert.deepEqual(metadata.native_trust, packed.native_trust);
    assert.deepEqual(metadata.execution_profile, packed.execution_profile);
    const aggregate = aggregateAppTargetCandidates(root);
    assert.deepEqual(aggregate.targets[0].native_trust, packed.native_trust);
    assert.deepEqual(aggregate.targets[0].execution_profile, packed.execution_profile);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production pack binds windows-x86_64 to an AMD64 user-mode executable PE', { skip: !WINDOWS_X86_64 }, () => {
  for (const [name, options, expected] of [
    ['x86 image', { platform: 'x86' }, /machine must be AMD64/u],
    ['DLL image', { target: 'library' }, /IMAGE_FILE_DLL/u],
    ['native subsystem', { subsystem: 1 }, /subsystem must be WINDOWS_GUI or WINDOWS_CUI/u],
  ]) {
    const root = fixture();
    try {
      const executablePath = compileUnsignedWindowsPe(root, options);
      assert.throws(
        () => observeWindowsExecutableFacts(executablePath),
        expected,
        name,
      );
      assert.throws(
        () => packAppTarget(root, { target: 'windows-x86_64', production: true }),
        expected,
        name,
      );
      assert.equal(existsSync(path.join(root, 'dist', 'nimi-app')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('Windows activation context admits documented v2-v3 and default-uiAccess forms', { skip: !WINDOWS_X86_64 }, () => {
  for (const options of [
    { manifestStyle: 'v2-v3', uiAccess: 'missing' },
    { target: 'exe' },
  ]) {
    const root = fixture();
    try {
      const executablePath = compileUnsignedWindowsPe(root, options);
      assert.deepEqual(observeWindowsExecutableFacts(executablePath).execution_profile, {
        requested_execution_level: 'asInvoker',
        ui_access: false,
      });
      assert.equal(packAppTarget(root, { target: 'windows-x86_64', production: true }).target_id, 'windows-x86_64');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('Windows activation context rejects malformed or contradictory manifests', { skip: !WINDOWS_X86_64 }, () => {
  for (const options of [
    { assemblyNamespace: 'urn:nimi:invalid-assembly' },
    { trustNamespace: 'urn:nimi:invalid-trust' },
    { executionNamespace: 'urn:nimi:invalid-execution-level' },
    { manifestVersion: '2.0' },
    { uiAccess: 'empty' },
    { additionalLevel: 'requireAdministrator' },
  ]) {
    const root = fixture();
    try {
      compileUnsignedWindowsPe(root, options);
      assert.throws(
        () => packAppTarget(root, { target: 'windows-x86_64', production: true }),
        /Windows executable profile verification failed/u,
      );
      assert.equal(existsSync(path.join(root, 'dist', 'nimi-app')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('production pack preserves a real valid Windows signer', { skip: !WINDOWS_X86_64 }, () => {
  const root = fixture();
  try {
    const signed = copyRealSignedWindowsPe(root);
    const packed = packAppTarget(root, { target: 'windows-x86_64', production: true });
    assert.deepEqual(packed.native_trust, {
      posture: 'observed-valid-native-signature',
      windows_authenticode: 'valid',
      certificate_subject: signed.observed.authenticode.certificate_subject,
    });
    assert.deepEqual(packed.execution_profile, { requested_execution_level: 'asInvoker', ui_access: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production pack rejects a machine-local catalog signature as publisher signing', { skip: !WINDOWS_X86_64 }, () => {
  const root = fixture();
  try {
    const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
    assert.ok(windowsRoot, 'Windows root is unavailable');
    const catalogSigned = path.join(windowsRoot, 'System32', 'cmd.exe');
    const observed = observeWindowsExecutableFacts(catalogSigned);
    assert.equal(observed.authenticode.status, 'Valid');
    assert.equal(observed.authenticode.signature_type, 'Catalog');
    writeFileSync(runtimeEntryPath(root), readFileSync(catalogSigned));
    assert.throws(
      () => packAppTarget(root, { target: 'windows-x86_64', production: true }),
      /status=Valid, type=Catalog/u,
    );
    assert.equal(existsSync(path.join(root, 'dist', 'nimi-app')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production pack fails closed after a real signed PE is tampered', { skip: !WINDOWS_X86_64 }, () => {
  const root = fixture();
  try {
    copyRealSignedWindowsPe(root);
    const executablePath = runtimeEntryPath(root);
    tamperFirstPeCodeSection(executablePath);
    const observed = observeWindowsExecutableFacts(executablePath);
    assert.notEqual(observed.authenticode.status, 'Valid');
    assert.notEqual(observed.authenticode.status, 'NotSigned');
    assert.equal(observed.authenticode.signature_type, 'Authenticode');
    assert.throws(
      () => packAppTarget(root, { target: 'windows-x86_64', production: true }),
      /Windows Authenticode verification failed/u,
    );
    assert.equal(existsSync(path.join(root, 'dist', 'nimi-app')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production pack rejects prohibited or absent Windows execution profiles', { skip: !WINDOWS_X86_64 }, () => {
  for (const profile of [
    { level: 'highestAvailable' },
    { level: 'requireAdministrator' },
    { level: 'asInvoker', uiAccess: true },
    { manifest: false },
  ]) {
    const root = fixture();
    try {
      compileUnsignedWindowsPe(root, profile);
      assert.throws(
        () => packAppTarget(root, { target: 'windows-x86_64', production: true }),
        /Windows executable profile verification failed/u,
      );
      assert.equal(existsSync(path.join(root, 'dist', 'nimi-app')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('aggregate reopens the archive and rejects native or execution lineage drift', { skip: !WINDOWS_X86_64 }, () => {
  const root = fixture();
  try {
    compileUnsignedWindowsPe(root);
    const packed = packAppTarget(root, { target: 'windows-x86_64', production: true });
    const originalMetadata = JSON.parse(readFileSync(packed.metadataPath, 'utf8'));

    const metadataNativeDrift = structuredClone(originalMetadata);
    metadataNativeDrift.native_trust = {
      posture: 'observed-valid-native-signature',
      windows_authenticode: 'valid',
      certificate_subject: 'CN=Different Publisher',
    };
    writeFileSync(packed.metadataPath, `${JSON.stringify(metadataNativeDrift, null, 2)}\n`);
    assert.throws(() => aggregateAppTargetCandidates(root), /does not match archive manifest native_trust/u);

    const metadataProfileDrift = structuredClone(originalMetadata);
    metadataProfileDrift.execution_profile.ui_access = true;
    writeFileSync(packed.metadataPath, `${JSON.stringify(metadataProfileDrift, null, 2)}\n`);
    assert.throws(() => aggregateAppTargetCandidates(root), /execution_profile must be exactly/u);

    const archiveEntries = readNimiAppArchive(readFileSync(packed.artifactPath));
    const archiveManifest = JSON.parse(archiveEntries.get('manifest.json').bytes.toString('utf8'));
    archiveManifest.native_trust = {
      posture: 'observed-valid-native-signature',
      windows_authenticode: 'valid',
      certificate_subject: 'CN=Archive Drift',
    };
    const changedArchive = writeNimiAppArchive([...archiveEntries].map(([name, entry]) => ({
      name,
      bytes: name === 'manifest.json' ? Buffer.from(`${JSON.stringify(archiveManifest, null, 2)}\n`) : entry.bytes,
      mode: entry.mode,
    })));
    writeFileSync(packed.artifactPath, changedArchive);
    const metadataForChangedArchive = structuredClone(originalMetadata);
    metadataForChangedArchive.size = changedArchive.length;
    metadataForChangedArchive.sha256 = createHash('sha256').update(changedArchive).digest('hex');
    writeFileSync(packed.metadataPath, `${JSON.stringify(metadataForChangedArchive, null, 2)}\n`);
    assert.throws(() => aggregateAppTargetCandidates(root), /does not match archive manifest native_trust/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pack fails when runtime entry is absent and never invents cross-target output', () => {
  const root = fixture();
  try {
    const profilePath = path.join(root, '.nimi', 'config', 'build-profile.yaml');
    writeFileSync(profilePath, readFileSync(profilePath, 'utf8').replace('payload/example-app.exe', 'payload/missing.exe'));
    assert.throws(() => packAppTarget(root, { target: 'windows-x86_64' }), /runtime_entry is missing/u);
    assert.throws(() => packAppTarget(root, { target: 'macos-aarch64' }), /Unsupported App package target/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pack requires the App project license in the immutable archive', () => {
  const root = fixture();
  try {
    rmSync(path.join(root, 'LICENSE'));
    assert.throws(() => packAppTarget(root, { target: 'windows-x86_64' }), /LICENSE is missing/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('aggregate verifies final target bytes and creates one version candidate', () => {
  const root = fixture();
  try {
    const packed = packAppTarget(root, { target: 'windows-x86_64' });
    const aggregate = aggregateAppTargetCandidates(root);
    assert.equal(aggregate.targets.length, 1);
    assert.equal(aggregate.targets[0].sha256, packed.sha256);
    const candidate = JSON.parse(readFileSync(aggregate.candidatePath, 'utf8'));
    assert.equal(candidate.format, 'nimi.app-release-candidate/v1');
    assert.deepEqual(candidate.targets.map((entry) => entry.target_id), ['windows-x86_64']);

    writeFileSync(packed.artifactPath, 'changed');
    assert.throws(() => aggregateAppTargetCandidates(root), /changed after pack/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit Tauri pack independently enforces package, manifest, Cargo, and Tauri version lockstep', () => {
  const root = fixture({ buildProfileRef: 'tauri-pnpm-vite' });
  try {
    writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), '{"version":"0.2.0"}\n');
    assert.throws(
      () => packAppTarget(root, { target: 'windows-x86_64' }),
      /versions must be exact and lockstep/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects unknown build profile refs and applies Tauri source checks only to the explicit Tauri profile', () => {
  const electronRoot = fixture();
  const tauriRoot = fixture({ buildProfileRef: 'tauri-pnpm-vite' });
  try {
    rmSync(path.join(electronRoot, 'src-tauri'), { recursive: true, force: true });
    assert.equal(packAppTarget(electronRoot, { target: 'windows-x86_64' }).target_id, 'windows-x86_64');

    const electronProfilePath = path.join(electronRoot, '.nimi', 'config', 'build-profile.yaml');
    writeFileSync(electronProfilePath, readFileSync(electronProfilePath, 'utf8').replace(
      'electron-packager-pnpm-vite',
      'unknown-packager',
    ));
    assert.throws(
      () => packAppTarget(electronRoot, { target: 'windows-x86_64' }),
      /build_profile_ref is unsupported: unknown-packager/u,
    );

    rmSync(path.join(tauriRoot, 'src-tauri'), { recursive: true, force: true });
    assert.throws(
      () => packAppTarget(tauriRoot, { target: 'windows-x86_64' }),
      /src-tauri\/Cargo\.toml is missing/u,
    );
  } finally {
    rmSync(electronRoot, { recursive: true, force: true });
    rmSync(tauriRoot, { recursive: true, force: true });
  }
});

test('archive reader rejects changed bytes', () => {
  const root = fixture();
  try {
    const packed = packAppTarget(root, { target: 'windows-x86_64' });
    const bytes = readFileSync(packed.artifactPath);
    bytes[50] ^= 0xff;
    assert.throws(() => readNimiAppArchive(bytes), /digest mismatch|Invalid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
