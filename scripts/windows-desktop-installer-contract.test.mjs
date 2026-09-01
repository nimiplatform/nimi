import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const builderSource = readFileSync(
  path.join(scriptRoot, 'build-windows-desktop-installer.mjs'),
  'utf8',
);
const installerInclude = readFileSync(
  path.join(repoRoot, 'apps', 'desktop', 'windows', 'installer.nsh'),
  'utf8',
);
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const desktopPackage = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'),
);

test('Windows Desktop installer is an explicit non-promotable local-development target', () => {
  assert.equal(
    rootPackage.scripts['build:windows:desktop:dev-candidate'],
    'node scripts/build-windows-desktop-installer.mjs --local-development-candidate',
  );
  assert.equal(desktopPackage.devDependencies['electron-builder'], '26.15.3');
  assert.match(builderSource, /candidateKind: 'local-development'/u);
  assert.match(builderSource, /promotable: false/u);
  assert.match(builderSource, /forceCodeSigning: true/u);
  assert.match(builderSource, /perMachine: true/u);
  assert.match(builderSource, /deleteAppDataOnUninstall: false/u);
  assert.match(
    builderSource,
    /Windows production installer is unavailable until the admitted production signing\/import contract exists/u,
  );
});

test('outer Nimi installer delegates Runtime lifecycle only to the signed service installer', () => {
  assert.match(installerInclude, /File \/oname=install-nimi-runtime\.ps1/u);
  assert.match(installerInclude, /-Mode \$\{MODE\}/u);
  assert.match(installerInclude, /RunNimiRuntimeServiceInstaller "Install"/u);
  assert.match(installerInclude, /-Mode Uninstall/u);
  assert.match(installerInclude, /\$\{IfNot\} \$\{isUpdated\}/u);
  assert.match(installerInclude, /\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe/u);
  assert.doesNotMatch(installerInclude, /\$(?:APPDATA|LOCALAPPDATA|PROGRAMDATA)/u);
  assert.doesNotMatch(installerInclude, /(?:models|dependencies|environments|accounts)[\\/]/u);
});

test('installer build verifies one signing identity across Desktop, Runtime, and setup', () => {
  assert.match(builderSource, /requireWindowsDevSignedFiles\(/u);
  assert.match(builderSource, /runtimeInstallerPath/u);
  assert.match(builderSource, /nativeCarriers/u);
  assert.match(builderSource, /setupCandidates\.length !== 1/u);
  assert.match(builderSource, /signerCertificateSha256: identity\.certificateSha256/u);
});
